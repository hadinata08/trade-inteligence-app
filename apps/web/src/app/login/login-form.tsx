"use client";

import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";

export function LoginForm({ nextPath, error }: { nextPath: string; error?: string }) {
  const [message, setMessage] = useState(error || "");
  const [pending, setPending] = useState(false);

  return (
    <form
      className="mt-8 space-y-4 rounded-md border border-line bg-card p-6"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setMessage("");
        const form = new FormData(event.currentTarget);
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
        });
        setPending(false);
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setMessage(body?.error || "Masuk gagal.");
          return;
        }
        window.location.href = nextPath;
      }}
    >
      <Field label="Email">
        <Input name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label="Kata sandi">
        <Input name="password" type="password" autoComplete="current-password" minLength={12} required />
      </Field>
      {message ? <p className="text-sm text-clay">{message}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Memeriksa…" : "Masuk"}</Button>
    </form>
  );
}
