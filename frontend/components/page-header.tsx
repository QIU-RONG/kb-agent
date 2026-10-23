export function PageHeader({
  title,
  desc,
  right,
}: {
  title: string;
  desc?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex items-start justify-between gap-6 border-b border-line pb-5">
      <div className="min-w-0">
        <h1 className="text-[21px] font-semibold tracking-[-0.02em]">{title}</h1>
        {desc && <p className="mt-1.5 max-w-prose text-[13px] leading-6 text-muted">{desc}</p>}
      </div>
      {right && <div className="shrink-0 pt-1">{right}</div>}
    </div>
  );
}
