"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/ui/icons";
import type { ChatMessage, PendingPreview } from "@/server/platform/agent-chat";

/**
 * ADR-025 pattern 6 starting points — deliberately generic (the assistant
 * runs with the actor's own authority, ADR-017, so it can't assume any
 * particular capability is active). A capability-aware set is a real
 * enhancement, not built here — this is the platform-wide default.
 */
const SUGGESTED_PROMPTS = [
  "Summarize what changed this week",
  "What needs my attention right now?",
  "Show me anything overdue",
];

/**
 * The AI assistant — Task 84 area 6.
 *
 * A PERSISTENT SHELL REGION, not a modal (Task 81 rule 10). It stays mounted
 * across every page the shell renders; only its open/closed state changes,
 * which is why it lives here rather than behind a route. Docked bottom-right
 * rather than centred-overlay so it never blocks the page underneath while
 * open — a person can keep working while it answers.
 *
 * Executes with the same authority as the signed-in person (ADR-017): every
 * tool call the server route makes runs through the ordinary
 * `executeCommand`/`executeQuery` pipeline as this session's own actor.
 * Nothing here grants anything; it only gives that actor a conversational
 * way to call tools they already hold.
 */
export function AgentChatDock() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PendingPreview | null>(null);
  const [groundingWarnings, setGroundingWarnings] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  async function send() {
    const text = input.trim();
    if (!text || pending) return;

    const nextHistory = [...messages, { role: "user", content: text } satisfies ChatMessage];
    setMessages(nextHistory);
    setInput("");
    setError(null);
    setPreview(null);
    setGroundingWarnings([]);
    setPending(true);

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, history: messages }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.message ?? "The assistant could not complete that request.");
        return;
      }
      setMessages([...nextHistory, { role: "assistant", content: json.data.reply } satisfies ChatMessage]);
      if (json.data.preview) setPreview(json.data.preview);
      if (json.data.groundingWarnings?.length) setGroundingWarnings(json.data.groundingWarnings);
    } catch {
      setError("Could not reach the assistant. Check your connection and try again.");
    } finally {
      setPending(false);
      queueMicrotask(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
    }
  }

  /** Task 81 rule 8 step 3 — runs the EXACT inputs the preview showed, never
   *  asking the model to re-derive them. `preview` itself is never re-sent
   *  to the model; this call bypasses the provider entirely. */
  async function confirmPreview() {
    if (!preview || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmPreview: { commandKey: preview.commandKey, inputs: preview.inputs } }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.message ?? "Could not complete that action.");
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: json.data.reply } satisfies ChatMessage]);
    } catch {
      setError("Could not reach the assistant. Check your connection and try again.");
    } finally {
      setPreview(null);
      setPending(false);
      queueMicrotask(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
    }
  }

  function cancelPreview() {
    setPreview(null);
    setMessages((prev) => [...prev, { role: "assistant", content: "Cancelled — nothing was changed." } satisfies ChatMessage]);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="agent-chat-panel"
        title="Assistant"
        // P1-05 raised the mobile floor: a fixed bottom tab bar now sits at
        // `bottom-0`, `h-16` plus the device safe-area inset. `bottom-6`
        // alone put this button underneath it. `lg:bottom-6` restores the
        // original offset once the tab bar is gone (`lg:hidden`).
        className="glass-control fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-6 z-40 grid size-12 place-items-center rounded-full text-text-secondary transition-colors hover:text-text print:hidden lg:bottom-6"
      >
        <Icon name={open ? "close" : "assistant"} size={20} />
        <span className="sr-only">{open ? "Close assistant" : "Open assistant"}</span>
      </button>

      {open && (
        <div
          id="agent-chat-panel"
          role="complementary"
          aria-label="Assistant"
          className="glass-overlay fixed bottom-[calc(8.5rem+env(safe-area-inset-bottom))] right-6 z-40 flex h-[min(560px,70dvh)] w-[min(380px,calc(100vw-3rem))] flex-col overflow-hidden rounded-[14px] print:hidden lg:bottom-24"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3.5">
            <span className="text-[14px] font-medium text-text">Assistant</span>
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <>
                <p className="text-[13px] text-text-tertiary">
                  Ask about your Work, Parties, or anything else in this workspace. I can only see
                  and do what your own role can.
                </p>
                {/* ADR-025 pattern 6: suggested prompts as full-width tappable
                    rows, not a bulleted list. */}
                <div className="flex flex-col gap-1.5">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => setInput(prompt)}
                      className="verity-solid w-full cursor-pointer rounded-[10px] px-3 py-2.5 text-left text-[13px] text-text-secondary transition-colors hover:text-text"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  "max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13.5px] leading-relaxed " +
                  (m.role === "user"
                    ? "ml-auto bg-accent text-accent-on"
                    : "verity-solid text-text")
                }
              >
                {m.content}
              </div>
            ))}
            {preview && (
              <div className="bg-control max-w-[92%] rounded-[12px] px-3.5 py-3 text-[13.5px] text-text">
                <p className="mb-2.5">{preview.description}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void confirmPreview()}
                    disabled={pending}
                    className="bg-accent text-accent-on rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={cancelPreview}
                    disabled={pending}
                    className="verity-solid rounded-[10px] px-3 py-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {groundingWarnings.length > 0 && (
              <p className="text-[12px] text-text-tertiary">
                Double-check: {groundingWarnings.join(", ")} — not confirmed against a query this turn.
              </p>
            )}
            {pending && <p className="text-[13px] text-text-tertiary">Thinking…</p>}
            {error && <p className="text-[13px] text-danger">{error}</p>}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex shrink-0 items-center gap-2 border-t border-line p-3"
          >
            <label htmlFor="agent-chat-input" className="sr-only">
              Message the assistant
            </label>
            <input
              id="agent-chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the assistant…"
              disabled={pending}
              className="verity-solid h-11 flex-1 rounded-[10px] px-3.5 text-[13.5px] text-text placeholder:text-text-tertiary focus:outline-none"
            />
            <button
              type="submit"
              disabled={pending || input.trim().length === 0}
              className="bg-accent text-accent-on grid size-11 shrink-0 place-items-center rounded-lg font-medium transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Icon name="chevronRight" size={18} />
              <span className="sr-only">Send</span>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
