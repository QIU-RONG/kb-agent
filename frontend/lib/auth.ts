"use client";

/** 前端登录态：token 存 localStorage，所有请求带 Authorization 头。
 *
 * 说明：localStorage 有 XSS 风险，生产更推荐 httpOnly cookie。
 * 这里选 localStorage 是因为 BFF 是 Next 的 route handler，
 * 加 cookie 会牵扯 CSRF 和 SameSite 配置，对演示项目收益不大。
 */

const TOKEN_KEY = "kb_token";
const USER_KEY = "kb_user";

export type AuthUser = {
  id: string;
  username: string;
  display_name: string;
  role: string;
  scopes: string[];
};

export const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  hr: "HR",
  finance: "财务",
  employee: "员工",
};

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function saveAuth(token: string, user: AuthUser): void {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const res = await fetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = "登录失败";
    try {
      detail = JSON.parse(text).detail ?? detail;
    } catch {
      /* 非 JSON 就用默认文案 */
    }
    throw new Error(detail);
  }

  const data = (await res.json()) as { access_token: string; user: AuthUser };
  saveAuth(data.access_token, data.user);
  return data.user;
}

export function logout(): void {
  clearAuth();
  window.location.href = "/login";
}

/** 401 时统一清理并跳登录，避免每个页面各写一遍 */
export function handleUnauthorized(): void {
  clearAuth();
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}
