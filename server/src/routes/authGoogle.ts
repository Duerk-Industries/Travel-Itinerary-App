import { Router } from "express";
import passport from "passport";
import { authCookieName, authenticate, createToken } from "../auth";

const router = Router();

const frontendLoginUrl = process.env.FRONTEND_LOGIN_URL ?? "http://localhost:8081";
const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:8081";
const isDev = process.env.NODE_ENV !== "production";
const authCookieOptions = {
  httpOnly: true,
  secure: !isDev,
  sameSite: (isDev ? "lax" : "none") as "lax" | "none",
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/",
};

router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: frontendLoginUrl,
    session: false,
  }),
  async (req, res) => {
    const user = req.user as { id: string; email: string; provider: "google" | "apple" | "email" } | undefined;
    if (!user) {
      res.status(400).json({ error: "Google login missing user profile" });
      return;
    }
    try {
      const token = createToken({ userId: user.id, email: user.email, provider: user.provider });
      res.cookie(authCookieName, token, authCookieOptions);
      const normalizedFrontend = frontendUrl.replace(/\/+$/, "");
      const redirectUrl = isDev
        ? `${normalizedFrontend}/#token=${encodeURIComponent(token)}`
        : normalizedFrontend;
      res.redirect(redirectUrl);
    } catch (err) {
      console.error("Google login failed", err);
      res.redirect(frontendLoginUrl);
    }
  }
);

router.get("/me", authenticate, (req, res) => {
  res.json(req.user);
});

router.post("/logout", (_req, res) => {
  res.clearCookie(authCookieName, authCookieOptions);
  res.status(204).send();
});

export default router;
