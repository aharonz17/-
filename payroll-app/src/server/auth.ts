import "server-only";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";

const COOKIE = "payroll_session";
const SESSION_DAYS = 7;

export type User = { id: number; username: string };

export function userCount() {
  return (getDb().prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c;
}

export function createUser(username: string, password: string) {
  if (password.length < 8) throw new Error("הסיסמה חייבת להכיל לפחות 8 תווים.");
  const hash = bcrypt.hashSync(password, 12);
  return getDb().prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username.trim(), hash).lastInsertRowid as number;
}

export async function login(username: string, password: string): Promise<boolean> {
  const row = getDb().prepare("SELECT id, password_hash FROM users WHERE username = ?").get(username.trim()) as { id: number; password_hash: string } | undefined;
  if (!row || !bcrypt.compareSync(password, row.password_hash)) return false;
  const id = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  getDb().prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  getDb().prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(id, row.id, expires.toISOString());
  (await cookies()).set(COOKIE, id, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    path: "/", expires,
  });
  return true;
}

export async function logout() {
  const c = await cookies();
  const id = c.get(COOKIE)?.value;
  if (id) getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
  c.delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const id = (await cookies()).get(COOKIE)?.value;
  if (!id) return null;
  const row = getDb().prepare(`SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`)
    .get(id, new Date().toISOString()) as User | undefined;
  return row ?? null;
}

/** לשימוש בכל דף, Server Action ו-Route Handler */
export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}
