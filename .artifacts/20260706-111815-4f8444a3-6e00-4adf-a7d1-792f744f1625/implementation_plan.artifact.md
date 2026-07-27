# Database Adapter and Schema Parity Alignment

Ensure that the Firebase and PostgreSQL adapters and schemas are fully equivalent across all features, especially the recently added Trip Blog functionality.

## User Review Required

- **Trip Blog Modality Storage**: In Postgres, we use separate tables (`blog_text_contents`, `blog_item_payloads`) for different modalities. In Firebase, we store everything within the `blog_items` document to leverage its flexible nature. This is a design choice to optimize for Firestore's pricing (fewer reads).
- **Search Logic**: Postgres search uses `ILIKE` on the `blog_text_contents` table. Firebase search will be implemented using a simple substring filter or a separate search index if needed, but for parity, a basic filter is proposed first.

## Proposed Changes

### Database Provider Configuration

#### [.env](file:///C:/Git/Tristan/Travel-Itinerary-App/server/.env)
- Verified `DB_PROVIDER=firebase` is set.
- Verified all necessary Firebase configuration variables are present.

---

### Blog Repository (Refactoring for Parity)

Move hardcoded Postgres queries from routes into the repository layer.

#### [repository.ts](file:///C:/Git/Tristan/Travel-Itinerary-App/server/src/blog/repository.ts)
- Add exports for new repository methods: `getPublicPath`, `isBlogPublic`, `createModalityItem`, and `search`.

#### [postgresRepository.ts](file:///C:/Git/Tristan/Travel-Itinerary-App/server/src/blog/postgresRepository.ts)
- Implement `getBlogPublicPath` using `blog_public_aliases`.
- Implement `isBlogPublic` using `blog_publication_epochs`.
- Implement `createBlogModalityItem` handling `blog_items` and `blog_item_payloads`.
- Implement `searchBlog` using `ILIKE` on `blog_text_contents`.

#### [firebaseRepository.ts](file:///C:/Git/Tristan/Travel-Itinerary-App/server/src/blog/firebaseRepository.ts)
- Implement `getBlogPublicPath` using `blog_public_aliases` collection.
- Implement `isBlogPublic` using `blog_publication_epochs` collection.
- Implement `createBlogModalityItem` storing payload in the `blog_items` document.
- Implement `searchBlog` using a collection filter.

---

### Route Cleanup

Replace direct `queryBlog` calls with repository methods.

#### [blogRoutes.ts](file:///C:/Git/Tristan/Travel-Itinerary-App/server/src/routes/blogRoutes.ts)
- Use `blogRepository().getPublicPath(tripId)` for canonical URL resolution.

#### [blogSocialRoutes.ts](file:///C:/Git/Tristan/Travel-Itinerary-App/server/src/routes/blogSocialRoutes.ts)
- Use `blogRepository().isBlogPublic(tripId)` for the social posting precondition check.

#### [blogModalityRoutes.ts](file:///C:/Git/Tristan/Travel-Itinerary-App/server/src/routes/blogModalityRoutes.ts)
- Use `blogRepository().createBlogModalityItem(...)` for new item creation.
- Use `blogRepository().searchBlog(...)` for searching items.

---

### Verification Plan

#### Automated Tests
- Run `cd server && npm test` to ensure existing Postgres tests pass.
- Run `cd server && DB_PROVIDER=firebase npm test` (using Firebase emulator) to verify Firebase parity.
- *Note: I will verify which tests exercise the blog features specifically.*

#### Manual Verification
- Deploy to a test environment with `DB_PROVIDER=firebase`.
- Verify Trip Blog creation, media upload, and public sharing work as expected.
- Verify Social posting check and Search functionality.
