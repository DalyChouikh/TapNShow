import { CreateWorkspaceForm } from "./create-workspace-form";

/** `/w/new`: create a workspace (spec §7.1). */
export default function NewWorkspacePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4">
      <CreateWorkspaceForm />
    </main>
  );
}
