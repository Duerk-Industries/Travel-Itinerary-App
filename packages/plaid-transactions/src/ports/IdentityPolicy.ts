/**
 * IdentityPolicy allows the host application to define how it maps
 * a Firebase UID to its internal user model and any additional
 * authorization checks.
 */
export interface IdentityPolicy {
  /**
   * Verify if the given Firebase UID is authorized to perform actions
   * in the module.
   */
  authorize(uid: string): Promise<boolean>;
}
