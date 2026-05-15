import { Suspense } from "react";
import { SignInForm } from "@/components/auth/sign-in-form";
import { MashiMark } from "@/components/shared/mashi-mark";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <MashiMark size={26} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Mashi</h1>
          <p className="text-sm text-muted-foreground">
            Personal AI Chief of Staff.
          </p>
        </div>
        <Suspense>
          <SignInForm />
        </Suspense>
      </div>
    </div>
  );
}
