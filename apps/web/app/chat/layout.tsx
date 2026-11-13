export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-background">
      {children}
    </div>
  );
}
