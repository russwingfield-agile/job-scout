export function Placeholder({ title }: { title: string }) {
  return (
    <section>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
        Coming in a later milestone.
      </p>
    </section>
  );
}
