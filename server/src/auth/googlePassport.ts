import passport from "passport";
import { Strategy as GoogleStrategy, Profile } from "passport-google-oauth20";
import { upsertGoogleUser } from "../db";

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL ??
        "http://localhost:4000/auth/google/callback",
    },
    async (_accessToken, _refreshToken, profile: Profile, done) => {
      try {
        const email = profile.emails?.[0]?.value ?? null;
        if (!email) {
          done(new Error("Google account missing email"));
          return;
        }
        const name = profile.displayName ?? null;
        const photo = profile.photos?.[0]?.value ?? null;
        const user = await upsertGoogleUser(profile.id, email, name, photo);
        done(null, user);
      } catch (err) {
        done(err as Error);
      }
    }
  )
);
