import * as React from "react";

export function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{title}</h2>
      <p className="max-w-[60ch] text-base leading-relaxed text-pretty text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

export function PageContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10 sm:px-6 md:py-16">
        {children}
      </div>
    </div>
  );
}
