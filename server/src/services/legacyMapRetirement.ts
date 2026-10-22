import { createHash } from 'crypto';
import { z } from 'zod';
import { deleteLegacyBlogMapArtifact, listLegacyBlogMapArtifacts, writeAuditLog } from '../db';
import type { LegacyBlogMapArtifact } from '../types';
const date = z.string().datetime();
const row = z.object({tripId:z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),dayDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),pointsHash:z.string().regex(/^[a-f0-9]{32}$/),path:z.string().max(350),generation:z.string().regex(/^\d{1,40}$/).nullable()}).strict();
const attestation = z.object({readersRetiredAt:date,writersDrainedAt:date,supportedClientWindowClosedAt:date,evidenceSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const manifestSchema = z.object({version:z.literal(1),project:z.string().min(1).max(128),bucket:z.string().min(1).max(200),createdAt:date,attestation,items:z.array(row).max(100),nextAfter:z.string().nullable(),skipped:z.array(z.string()).max(100)}).strict();
export type LegacyMapRetirementManifest = z.infer<typeof manifestSchema>;
export type LegacyMapObjectStore = {
  metadata:(path:string) => Promise<{generation:string;contentType:string}|null>;
  delete:(path:string,generation:string) => Promise<void>;
};
export const retirementManifestHash = (value:string) => createHash('sha256').update(value).digest('hex');
const validPath = (row:LegacyBlogMapArtifact) => row.path === `blog-maps/${row.tripId}/${row.dayDate}/${row.pointsHash}.png` && /^blog-maps\/[a-zA-Z0-9_-]{1,128}\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{32}\.png$/.test(row.path);
const verifyAttestation = (value: unknown, now:number) => {
  const parsed=attestation.parse(value);
  for(const stamp of [parsed.readersRetiredAt,parsed.writersDrainedAt,parsed.supportedClientWindowClosedAt]) if(Date.parse(stamp)>now-24*60*60*1000) throw new Error('Reader migration, writer drain and supported-client retirement require a full 24-hour grace period');
  return parsed;
};
export async function planLegacyMapRetirement(input:{project:string;bucket:string;attestation:unknown;after?:string},store:LegacyMapObjectStore,now=Date.now()):Promise<LegacyMapRetirementManifest> {
  const proof=verifyAttestation(input.attestation,now), rows=await listLegacyBlogMapArtifacts(input.after,100);
  const items:LegacyMapRetirementManifest['items']=[],skipped:string[]=[];
  for(const item of rows) {
    if(!validPath(item)) {skipped.push(item.path);continue;}
    const metadata=await store.metadata(item.path);
    if(metadata && metadata.contentType!=='image/png') {skipped.push(item.path);continue;}
    items.push({...item,generation:metadata?.generation ?? null});
  }
  return manifestSchema.parse({version:1,project:input.project,bucket:input.bucket,createdAt:new Date(now).toISOString(),attestation:proof,items,skipped,nextAfter:rows.length===100?rows[rows.length-1].path:null});
}
export async function applyLegacyMapRetirement(raw:string,expectedHash:string,target:{project:string;bucket:string},store:LegacyMapObjectStore,now=Date.now()) {
  if(retirementManifestHash(raw)!==expectedHash) throw new Error('Manifest checksum mismatch');
  const manifest=manifestSchema.parse(JSON.parse(raw));verifyAttestation(manifest.attestation,now);
  if(manifest.project!==target.project || manifest.bucket!==target.bucket || Date.parse(manifest.createdAt)>now || now-Date.parse(manifest.createdAt)>24*60*60*1000) throw new Error('Manifest target or freshness mismatch');
  if(new Set(manifest.items.map(item=>item.path)).size!==manifest.items.length || manifest.items.some(item=>!validPath(item))) throw new Error('Manifest contains duplicate or unsupported paths');
  // Durable request audit precedes every destructive batch; a failure here prevents deletion.
  await writeAuditLog({action:'LEGACY_MAP_RETIREMENT_REQUESTED',afterState:{manifestHash:expectedHash,project:target.project,bucket:target.bucket,count:manifest.items.length,evidenceSha256:manifest.attestation.evidenceSha256},reason:'Reviewed legacy blog-map retirement'});
  const retired:string[]=[],failed:Array<{path:string;reason:string}>=[];
  for(const item of manifest.items) {
    try {
      const metadata=await store.metadata(item.path);
      if(metadata && (metadata.generation!==item.generation || metadata.contentType!=='image/png')) throw new Error('Object changed since review');
      if(metadata) await store.delete(item.path,metadata.generation);
      await deleteLegacyBlogMapArtifact(item);
      await writeAuditLog({action:'LEGACY_MAP_ARTIFACT_RETIRED',afterState:{manifestHash:expectedHash,path:item.path,generation:item.generation},reason:'Deleted reviewed legacy map object and matching artifact row'});
      retired.push(item.path);
    } catch(error) {failed.push({path:item.path,reason:error instanceof Error?error.message:'Retirement failed'});}
  }
  return {retired,failed};
}
