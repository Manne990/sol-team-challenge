declare module "*.jsx" {
  import type { ComponentType } from "react";
  export const TasksPage: ComponentType<{
    role: "owner" | "member" | "viewer";
  }>;
}
