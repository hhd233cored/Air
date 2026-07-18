import { authenticatedRequest } from "./auth";

export type AdminUserRole = "USER" | "ADMIN";

export type AdminUser = {
  id: number;
  username: string;
  role: AdminUserRole;
  enabled: boolean;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminUserPage = {
  content: AdminUser[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

export type AdminUserCreateInput = {
  username: string;
  password: string;
  role: AdminUserRole;
  enabled: boolean;
};

export type AdminUserUpdateInput = {
  role?: AdminUserRole;
  enabled?: boolean;
};

export type RegistrationSetting = {
  enabled: boolean;
};

export function getAdminUsers({ page = 0, size = 20, query = "", role = "", enabled = "" }: {
  page?: number;
  size?: number;
  query?: string;
  role?: AdminUserRole | "";
  enabled?: "true" | "false" | "";
} = {}) {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  if (query.trim()) params.set("query", query.trim());
  if (role) params.set("role", role);
  if (enabled) params.set("enabled", enabled);
  return authenticatedRequest<AdminUserPage>(`/admin/users?${params.toString()}`);
}

export function createAdminUser(input: AdminUserCreateInput) {
  return authenticatedRequest<AdminUser>("/admin/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAdminUser(userId: number, input: AdminUserUpdateInput) {
  return authenticatedRequest<AdminUser>(`/admin/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function resetAdminPassword(userId: number, password: string) {
  return authenticatedRequest<AdminUser>(`/admin/users/${userId}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export function uploadAdminAvatar(userId: number, file: File) {
  const body = new FormData();
  body.append("avatar", file, file.name);
  return authenticatedRequest<AdminUser>(`/admin/users/${userId}/avatar`, {
    method: "PUT",
    body,
  });
}

export function deleteAdminAvatar(userId: number) {
  return authenticatedRequest<AdminUser>(`/admin/users/${userId}/avatar`, {
    method: "DELETE",
  });
}

export function getRegistrationSetting() {
  return authenticatedRequest<RegistrationSetting>("/admin/settings/registration");
}

export function updateRegistrationSetting(enabled: boolean) {
  return authenticatedRequest<RegistrationSetting>("/admin/settings/registration", {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}
