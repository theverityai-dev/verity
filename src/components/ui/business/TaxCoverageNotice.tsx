/** Keep unsupported filing workflows visible where working papers are used. */
export function TaxCoverageNotice() {
  return (
    <aside className="rounded-[12px] bg-surface p-4 text-sm text-text-secondary" aria-label="Tax coverage">
      These are working papers for regular GST registrations. Reverse-charge reporting,
      e-invoice registration (IRN), and composition returns are not supported.
      Complete any applicable requirements in your filing system before using these figures for a return.
    </aside>
  );
}
