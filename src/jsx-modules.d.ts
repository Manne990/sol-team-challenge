declare module "*.jsx" {
  import type { ComponentType } from "react";
  export const TasksPage: ComponentType<{
    role: "owner" | "member" | "viewer";
  }>;
  export const GlobalSearch: ComponentType;
  export const SavedViews: ComponentType<{
    resource: "companies" | "contacts" | "deals" | "tasks";
    definition: Record<string, unknown>;
    onApply: (definition: Record<string, unknown>) => void;
  }>;
  export const DuplicatesPage: ComponentType<{
    role: "owner" | "member" | "viewer";
  }>;
}
