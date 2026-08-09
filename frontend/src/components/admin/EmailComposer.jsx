import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import {
  TextAlignCenter, TextAlignLeft, TextAlignRight, ArrowDown, ArrowUp, Article, BracketsCurly,
  Check, Copy, DeviceMobile, Desktop, DotsSixVertical, Envelope, FloppyDisk,
  Image as ImageIcon, Link as LinkIcon, ListBullets, ListNumbers, Minus, Note,
  PaintBrush, Paragraph, Plus, Quotes, Rows, Selection, SquaresFour, TextB,
  TextHOne, TextHThree, TextHTwo, TextItalic, TextUnderline, Trash, Warning,
  X,
} from "@phosphor-icons/react";

const http = axios.create({ withCredentials: true });
const LOCAL_DRAFT_KEY = "xaucloud.email-composer.v1";
const EMPTY_THEME = { width: 640, background: "#08080A", contentBackground: "#FFFFFF", accent: "#D6B35A", radius: 10, spacing: "normal" };
const INPUT = "w-full rounded-lg border border-white/[0.09] bg-white/[0.04] px-3 py-2 text-[12px] text-white outline-none placeholder:text-white/25 focus:border-gold-300/50";
const LABEL = "mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-white/38";

function uid(prefix = "block") {
  return `${prefix}-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function plainText(html = "") {
  const node = document.createElement("div");
  node.innerHTML = html;
  return node.textContent || "";
}

function emptyCampaign() {
  return {
    subject: "",
    preview_text: "",
    sender_name: "XauCloud",
    reply_to: "",
    audience: "single",
    to: "",
    selected_recipients: [],
    document: {
      version: 1,
      theme: { ...EMPTY_THEME },
      blocks: [
        { id: uid(), type: "hero", badge: "XauCloud update", title: "A clear headline", subtitle: "Add one concise supporting message." },
        { id: uid(), type: "text", html: "<p>Hi {{first_name}},</p><p>Write the most important part of your update here.</p>" },
      ],
    },
  };
}

const BLOCKS = [
  ["text", "Text", Paragraph], ["heading", "Heading", TextHTwo], ["button", "Button", Selection],
  ["image", "Image", ImageIcon], ["divider", "Divider", Minus], ["spacer", "Spacer", Rows],
  ["callout", "Callout", Note], ["metrics", "Metrics", SquaresFour], ["columns", "2 columns", Rows],
  ["section", "Section", Article], ["hero", "Hero", TextHOne], ["announcement", "Announcement", Envelope],
  ["feature", "Feature", Check], ["steps", "Steps", ListNumbers], ["risk", "Risk notice", Warning],
  ["footer", "Footer", DotsSixVertical],
];

function createBlock(type) {
  const base = { id: uid(), type };
  const presets = {
    text: { html: "<p>Write your message here.</p>" },
    heading: { text: "Section heading", level: 2 },
    button: { text: "OPEN COMMAND CENTER", url: "https://xaucloud.io/command", align: "left", style: "gold" },
    image: { url: "https://", alt: "", width: 560, align: "center" },
    divider: { tone: "neutral" },
    spacer: { height: 24 },
    callout: { title: "Important", html: "<p>Add the information readers should notice.</p>", tone: "gold" },
    metrics: { title: "Performance overview", items: [{ label: "Net Profit", value: "+$9,968.01" }, { label: "Profit Factor", value: "2.12" }, { label: "Win Rate", value: "70.45%" }, { label: "Trades", value: "44" }] },
    columns: { columns: [{ title: "First column", html: "<p>Add content.</p>" }, { title: "Second column", html: "<p>Add content.</p>" }] },
    section: { title: "A focused section", html: "<p>Use this contained area to group related information.</p>", background: "#F5F0E1" },
    hero: { badge: "XauCloud update", title: "A strong, direct headline", subtitle: "One sentence that explains why this matters." },
    announcement: { badge: "Announcement", title: "What is changing", html: "<p>Explain the announcement clearly.</p>", background: "#F5F0E1" },
    feature: { badge: "✓", title: "Feature title", text: "Explain the customer benefit in one or two sentences." },
    steps: { title: "What to do next", items: [{ label: "Open Command Center", text: "Sign in to your XauCloud account." }, { label: "Complete the step", text: "Add clear instructions here." }] },
    risk: { text: "Trading involves risk. Historical and Strategy Tester results do not guarantee future performance. Live results may differ due to market conditions, spread, liquidity, slippage, execution and other factors." },
    footer: { text: "The required XauCloud support, account preferences, legal and risk footer is always included." },
  };
  return { ...base, ...(presets[type] || {}) };
}

function ToolButton({ active = false, label, onClick, children, disabled = false }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
    className={`flex h-8 w-8 items-center justify-center rounded-md transition disabled:opacity-25 ${active ? "bg-gold-300 text-black" : "text-white/55 hover:bg-white/[0.08] hover:text-white"}`}>{children}</button>;
}

function RichTextEditor({ value, onChange, compact = false }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true, linkOnPaste: true } }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: value || "<p></p>",
    immediatelyRender: false,
    editorProps: { attributes: { class: `xc-rich-editor ${compact ? "xc-rich-editor-compact" : ""}` } },
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value || "<p></p>", { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return <div className="h-32 animate-pulse rounded-lg bg-white/[0.04]" />;
  const setLink = () => {
    const previous = editor.getAttributes("link").href || "https://";
    const href = window.prompt("Link URL (https://…)", previous);
    if (href === null) return;
    if (!href) { editor.chain().focus().unsetLink().run(); return; }
    if (!/^https?:\/\//i.test(href)) { window.alert("Use a complete http:// or https:// URL."); return; }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };
  const format = editor.isActive("heading", { level: 1 }) ? "h1" : editor.isActive("heading", { level: 2 }) ? "h2" : editor.isActive("heading", { level: 3 }) ? "h3" : "p";
  const setFormat = (next) => {
    if (next === "p") editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level: Number(next.slice(1)) }).run();
  };
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.09] bg-[#0a0b0f] focus-within:border-gold-300/40">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-white/[0.07] bg-white/[0.025] p-1.5">
        <select aria-label="Text style" value={format} onChange={(event) => setFormat(event.target.value)} className="mr-1 h-8 rounded-md border-0 bg-white/[0.06] px-2 text-[11px] text-white outline-none">
          <option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option>
        </select>
        <ToolButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><TextB size={15} weight="bold" /></ToolButton>
        <ToolButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><TextItalic size={15} /></ToolButton>
        <ToolButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><TextUnderline size={15} /></ToolButton>
        <ToolButton label="Link" active={editor.isActive("link")} onClick={setLink}><LinkIcon size={15} /></ToolButton>
        <span className="mx-1 h-5 w-px bg-white/[0.08]" />
        <ToolButton label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><ListBullets size={15} /></ToolButton>
        <ToolButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListNumbers size={15} /></ToolButton>
        <ToolButton label="Blockquote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quotes size={15} /></ToolButton>
        <span className="mx-1 h-5 w-px bg-white/[0.08]" />
        <ToolButton label="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}><TextAlignLeft size={15} /></ToolButton>
        <ToolButton label="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}><TextAlignCenter size={15} /></ToolButton>
        <ToolButton label="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}><TextAlignRight size={15} /></ToolButton>
        <span className="mx-1 h-5 w-px bg-white/[0.08]" />
        <ToolButton label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><ArrowLeftGlyph /></ToolButton>
        <ToolButton label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><ArrowRightGlyph /></ToolButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function ArrowLeftGlyph() { return <span className="text-sm">↶</span>; }
function ArrowRightGlyph() { return <span className="text-sm">↷</span>; }

function Field({ label, children }) {
  return <label className="block"><span className={LABEL}>{label}</span>{children}</label>;
}

function Modal({ title, children, onClose, wide = false }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`max-h-[92dvh] w-full overflow-auto rounded-t-2xl border border-white/10 bg-[#0d0e13] shadow-2xl sm:rounded-2xl ${wide ? "max-w-5xl" : "max-w-lg"}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.07] bg-[#0d0e13]/95 px-5 py-4 backdrop-blur-xl"><h3 className="text-[14px] font-bold text-white">{title}</h3><button type="button" onClick={onClose} className="rounded-lg p-2 text-white/40 hover:bg-white/[0.06] hover:text-white" aria-label="Close"><X size={16} /></button></div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function PreviewFrame({ html, device }) {
  const width = device === "mobile" ? 390 : 760;
  return <div className="overflow-auto rounded-xl bg-[#e8e9eb] p-3 sm:p-5"><iframe title={`${device} email preview`} srcDoc={html} sandbox="" className="mx-auto block h-[720px] max-w-full rounded-lg border-0 bg-white shadow-lg transition-[width]" style={{ width }} /></div>;
}

function BlockLibrary({ addBlock }) {
  return <div className="grid grid-cols-2 gap-2">{BLOCKS.map(([type, name, Icon]) => <button key={type} type="button" onClick={() => addBlock(type)} className="group rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 text-left transition hover:border-gold-300/35 hover:bg-gold-300/[0.05]"><Icon size={17} className="mb-2 text-gold-300/70 group-hover:text-gold-300" /><span className="block text-[11px] font-semibold text-white/60 group-hover:text-white">{name}</span></button>)}</div>;
}

function TemplateLibrary({ templates, applyTemplate, deleteTemplate }) {
  return <div className="space-y-2">{templates.map((template) => <div key={template.id} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><div className="flex items-start justify-between gap-2"><div><div className="text-[11.5px] font-bold text-white/80">{template.name}</div><div className="mt-1 text-[10px] leading-4 text-white/35">{template.description}</div></div>{!template.builtIn && <button type="button" onClick={() => deleteTemplate(template.id)} className="text-white/25 hover:text-red-300" aria-label={`Delete ${template.name}`}><Trash size={13} /></button>}</div><button type="button" onClick={() => applyTemplate(template)} className="mt-3 w-full rounded-lg bg-gold-300 px-2 py-1.5 text-[10px] font-black text-black">USE TEMPLATE</button></div>)}</div>;
}

function DraftLibrary({ drafts, loadDraft, duplicateDraft, deleteDraft }) {
  return <div className="space-y-2">{drafts.length ? drafts.map((draft) => <div key={draft.id} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><div className="truncate text-[11.5px] font-bold text-white/80">{draft.title}</div><div className="mt-1 truncate text-[10px] text-white/35">{draft.subject}</div><div className="mt-1 text-[9px] text-white/25">{draft.updated_at ? new Date(draft.updated_at).toLocaleString() : "Not yet saved"}</div><div className="mt-3 flex gap-1.5"><button type="button" onClick={() => loadDraft(draft)} className="flex-1 rounded-lg bg-gold-300 px-2 py-1.5 text-[9px] font-black text-black">EDIT</button><button type="button" onClick={() => duplicateDraft(draft.id)} className="rounded-lg border border-white/10 p-1.5 text-white/50" aria-label="Duplicate draft"><Copy size={12} /></button><button type="button" onClick={() => deleteDraft(draft.id)} className="rounded-lg border border-white/10 p-1.5 text-white/50 hover:text-red-300" aria-label="Delete draft"><Trash size={12} /></button></div></div>) : <p className="py-8 text-center text-[11px] leading-5 text-white/30">No server drafts yet.<br />Your current work is still protected locally.</p>}</div>;
}

function CanvasBlock({ block, selected, onSelect, onUpdate, onMove, onDuplicate, onDelete, isFirst, isLast }) {
  const update = (patch) => onUpdate(block.id, patch);
  const shell = `group relative rounded-xl border p-3 transition ${selected ? "border-gold-300/60 bg-gold-300/[0.04] shadow-[0_0_0_1px_rgba(243,201,105,.12)]" : "border-white/[0.07] bg-white/[0.025] hover:border-white/[0.15]"}`;
  return (
    <div className={shell} onClick={() => onSelect(block.id)} data-block-type={block.type}>
      <div className="mb-2 flex items-center justify-between gap-2"><div className="flex items-center gap-2"><DotsSixVertical size={13} className="text-white/20" /><span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/32">{block.type}</span></div><div className={`flex items-center gap-0.5 ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}><ToolButton label="Move up" disabled={isFirst} onClick={(e) => { e?.stopPropagation?.(); onMove(block.id, -1); }}><ArrowUp size={12} /></ToolButton><ToolButton label="Move down" disabled={isLast} onClick={(e) => { e?.stopPropagation?.(); onMove(block.id, 1); }}><ArrowDown size={12} /></ToolButton><ToolButton label="Duplicate" onClick={(e) => { e?.stopPropagation?.(); onDuplicate(block.id); }}><Copy size={12} /></ToolButton><ToolButton label="Delete" onClick={(e) => { e?.stopPropagation?.(); onDelete(block.id); }}><Trash size={12} /></ToolButton></div></div>
      {block.type === "text" ? <RichTextEditor value={block.html} onChange={(html) => update({ html })} /> : null}
      {block.type === "heading" ? <input value={block.text || ""} onChange={(e) => update({ text: e.target.value })} className="w-full border-0 bg-transparent px-2 py-3 text-xl font-extrabold text-white outline-none" placeholder="Section heading" /> : null}
      {block.type === "hero" ? <div className="rounded-lg bg-[#111114] p-6"><div className="text-[9px] font-bold uppercase tracking-[.18em] text-gold-300">{block.badge}</div><div className="mt-2 text-2xl font-extrabold text-white">{block.title}</div><div className="mt-2 text-[12px] leading-5 text-white/50">{block.subtitle}</div></div> : null}
      {block.type === "announcement" ? <div className="rounded-lg bg-[#f5f0e1] p-5 text-[#111114]"><div className="text-[9px] font-black uppercase tracking-wider text-[#8a6200]">{block.badge}</div><div className="mt-2 text-lg font-extrabold">{block.title}</div></div> : null}
      {block.type === "button" ? <div className={`flex py-4 ${block.align === "center" ? "justify-center" : block.align === "right" ? "justify-end" : "justify-start"}`}><span className={`rounded-lg px-5 py-3 text-[11px] font-black ${block.style === "outline" ? "border border-gold-300 text-white" : block.style === "dark" ? "bg-white text-black" : "bg-gold-300 text-black"}`}>{block.text}</span></div> : null}
      {block.type === "image" ? <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-white/10 bg-white/[0.02]">{/^https?:\/\//.test(block.url || "") && block.url !== "https://" ? <img src={block.url} alt={block.alt || ""} className="max-h-48 max-w-full object-contain" /> : <div className="text-center text-white/25"><ImageIcon size={24} className="mx-auto mb-2" /><span className="text-[10px]">Add a secure image URL</span></div>}</div> : null}
      {block.type === "divider" ? <div className={`my-6 h-px ${block.tone === "gold" ? "bg-gold-300" : "bg-white/15"}`} /> : null}
      {block.type === "spacer" ? <div className="flex items-center justify-center rounded-lg border border-dashed border-white/[0.06] text-[9px] text-white/20" style={{ height: Math.min(block.height || 24, 72) }}>SPACER · {block.height || 24}px</div> : null}
      {block.type === "callout" ? <div className="border-l-4 border-gold-300 bg-[#f7f2e5] p-4 text-[#2f3035]"><div className="text-[11px] font-black uppercase text-[#8a6200]">{block.title}</div><div className="mt-2 text-xs">{plainText(block.html)}</div></div> : null}
      {block.type === "metrics" ? <div><div className="mb-3 text-sm font-bold text-white">{block.title}</div><div className="grid grid-cols-2 gap-2">{(block.items || []).map((item, i) => <div key={i} className="border-t-2 border-gold-300 bg-[#111114] p-3 text-center"><div className="text-lg font-black text-white">{item.value}</div><div className="mt-1 text-[8px] font-bold uppercase tracking-wider text-white/40">{item.label}</div></div>)}</div></div> : null}
      {block.type === "columns" ? <div className="grid grid-cols-2 gap-2">{(block.columns || []).map((column, i) => <div key={i} className="rounded-lg bg-white/[0.04] p-3"><div className="text-[11px] font-bold text-white">{column.title}</div><div className="mt-1 text-[10px] text-white/40">{plainText(column.html)}</div></div>)}</div> : null}
      {block.type === "section" ? <div className="rounded-lg bg-[#f5f0e1] p-5 text-[#222228]"><div className="font-extrabold">{block.title}</div><div className="mt-2 text-xs">{plainText(block.html)}</div></div> : null}
      {block.type === "feature" ? <div className="flex gap-3 p-2"><div className="flex h-8 w-8 flex-none items-center justify-center bg-gold-300 font-bold text-black">{block.badge}</div><div><div className="text-sm font-bold text-white">{block.title}</div><div className="mt-1 text-[11px] leading-5 text-white/45">{block.text}</div></div></div> : null}
      {block.type === "steps" ? <div className="space-y-2">{(block.items || []).map((item, i) => <div key={i} className="flex gap-3 rounded-lg bg-white/[0.03] p-3"><div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-gold-300 text-[10px] font-black text-black">{i + 1}</div><div><div className="text-[11px] font-bold text-white">{item.label}</div><div className="mt-1 text-[10px] text-white/38">{item.text}</div></div></div>)}</div> : null}
      {block.type === "risk" ? <div className="rounded-lg bg-white/[0.04] p-4 text-[10px] leading-5 text-white/40"><strong className="text-white/65">Risk disclosure:</strong> {block.text}</div> : null}
      {block.type === "footer" ? <div className="rounded-lg bg-[#111114] p-5 text-center text-[10px] leading-5 text-white/35">Required support, preferences, brand, and legal footer<br /><span className="text-gold-300/70">Managed by the XauCloud renderer</span></div> : null}
    </div>
  );
}

function InputSetting({ label, value = "", onChange, type = "text", min, max, placeholder }) {
  return <Field label={label}><input className={INPUT} type={type} value={value} min={min} max={max} placeholder={placeholder} onChange={(event) => onChange(type === "number" ? Number(event.target.value) : event.target.value)} /></Field>;
}

function SelectSetting({ label, value, onChange, options }) {
  return <Field label={label}><select className={INPUT} value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>;
}

function BlockSettings({ block, updateBlock, theme, updateTheme }) {
  if (!block) return <div className="py-12 text-center text-[11px] leading-5 text-white/30"><Selection size={24} className="mx-auto mb-3" />Select a block to edit its settings.</div>;
  const update = (patch) => updateBlock(block.id, patch);
  const richField = (label, key = "html") => <div><span className={LABEL}>{label}</span><RichTextEditor compact value={block[key] || ""} onChange={(value) => update({ [key]: value })} /></div>;
  return <div className="space-y-4">
    <div className="flex items-center gap-2 border-b border-white/[0.07] pb-3"><PaintBrush size={15} className="text-gold-300" /><div><div className="text-[12px] font-bold capitalize text-white">{block.type} block</div><div className="text-[9px] text-white/28">Email-safe settings</div></div></div>
    {block.type === "hero" ? <><InputSetting label="Badge" value={block.badge} onChange={(badge) => update({ badge })} /><InputSetting label="Headline" value={block.title} onChange={(title) => update({ title })} /><Field label="Supporting text"><textarea className={`${INPUT} min-h-20 resize-y`} value={block.subtitle || ""} onChange={(e) => update({ subtitle: e.target.value })} /></Field><InputSetting label="Optional button text" value={block.text} onChange={(text) => update({ text })} /><InputSetting label="Optional button URL" value={block.url} onChange={(url) => update({ url })} /></> : null}
    {block.type === "announcement" ? <><InputSetting label="Badge" value={block.badge} onChange={(badge) => update({ badge })} /><InputSetting label="Title" value={block.title} onChange={(title) => update({ title })} />{richField("Body")}</> : null}
    {block.type === "heading" ? <><InputSetting label="Heading" value={block.text} onChange={(text) => update({ text })} /><SelectSetting label="Level" value={String(block.level || 2)} onChange={(level) => update({ level: Number(level) })} options={[["1", "Heading 1"], ["2", "Heading 2"], ["3", "Heading 3"]]} /></> : null}
    {block.type === "button" ? <><InputSetting label="Button text" value={block.text} onChange={(text) => update({ text })} /><InputSetting label="URL" value={block.url} onChange={(url) => update({ url })} placeholder="https://xaucloud.io/…" /><SelectSetting label="Alignment" value={block.align || "left"} onChange={(align) => update({ align })} options={[["left", "Left"], ["center", "Center"], ["right", "Right"]]} /><SelectSetting label="Style" value={block.style || "gold"} onChange={(style) => update({ style })} options={[["gold", "Gold primary"], ["outline", "Gold outline"], ["dark", "Dark"]]} /><label className="flex items-center gap-2 text-[11px] text-white/55"><input type="checkbox" checked={Boolean(block.fullWidth)} onChange={(e) => update({ fullWidth: e.target.checked })} className="accent-gold-300" /> Full-width button</label></> : null}
    {block.type === "image" ? <><InputSetting label="Secure image URL" value={block.url} onChange={(url) => update({ url })} placeholder="https://…" /><InputSetting label="Alt text" value={block.alt} onChange={(alt) => update({ alt })} /><InputSetting label="Width (px)" type="number" min={80} max={640} value={block.width || 560} onChange={(width) => update({ width })} /><SelectSetting label="Alignment" value={block.align || "center"} onChange={(align) => update({ align })} options={[["left", "Left"], ["center", "Center"], ["right", "Right"]]} /><InputSetting label="Optional link" value={block.link} onChange={(link) => update({ link })} /></> : null}
    {block.type === "divider" ? <SelectSetting label="Divider style" value={block.tone || "neutral"} onChange={(tone) => update({ tone })} options={[["neutral", "Neutral"], ["gold", "Gold"]]} /> : null}
    {block.type === "spacer" ? <InputSetting label="Height (px)" type="number" min={8} max={120} value={block.height || 24} onChange={(height) => update({ height })} /> : null}
    {block.type === "callout" ? <><InputSetting label="Title" value={block.title} onChange={(title) => update({ title })} />{richField("Message")}<SelectSetting label="Tone" value={block.tone || "gold"} onChange={(tone) => update({ tone })} options={[["gold", "Information"], ["warning", "Warning / action"]]} /></> : null}
    {block.type === "section" ? <><InputSetting label="Title" value={block.title} onChange={(title) => update({ title })} />{richField("Content")}<SelectSetting label="Background" value={block.background || "#F5F0E1"} onChange={(background) => update({ background })} options={[["#F5F0E1", "Warm white"], ["#FFFFFF", "White"]]} /></> : null}
    {block.type === "feature" ? <><InputSetting label="Icon / number" value={block.badge} onChange={(badge) => update({ badge })} /><InputSetting label="Title" value={block.title} onChange={(title) => update({ title })} /><Field label="Description"><textarea className={`${INPUT} min-h-20`} value={block.text || ""} onChange={(e) => update({ text: e.target.value })} /></Field></> : null}
    {block.type === "risk" ? <Field label="Standardized disclaimer"><textarea className={`${INPUT} min-h-36`} value={block.text || ""} onChange={(e) => update({ text: e.target.value })} /></Field> : null}
    {["metrics", "steps"].includes(block.type) ? <><InputSetting label="Section title" value={block.title} onChange={(title) => update({ title })} /><div className="space-y-2">{(block.items || []).map((item, index) => <div key={index} className="rounded-lg border border-white/[0.07] p-2"><input className={`${INPUT} mb-2`} value={item.label || ""} placeholder={block.type === "metrics" ? "Label" : "Step title"} onChange={(e) => { const items = [...block.items]; items[index] = { ...item, label: e.target.value }; update({ items }); }} />{block.type === "metrics" ? <input className={INPUT} value={item.value || ""} placeholder="Value" onChange={(e) => { const items = [...block.items]; items[index] = { ...item, value: e.target.value }; update({ items }); }} /> : <textarea className={INPUT} value={item.text || ""} placeholder="Instruction" onChange={(e) => { const items = [...block.items]; items[index] = { ...item, text: e.target.value }; update({ items }); }} />}</div>)}<button type="button" onClick={() => update({ items: [...(block.items || []), block.type === "metrics" ? { label: "Metric", value: "0" } : { label: "Next step", text: "Add instructions." }] })} className="flex items-center gap-1 text-[10px] font-bold text-gold-300"><Plus size={11} /> Add item</button></div></> : null}
    {block.type === "columns" ? <div className="space-y-3">{(block.columns || []).map((column, index) => <div key={index} className="rounded-lg border border-white/[0.07] p-2"><InputSetting label={`Column ${index + 1} title`} value={column.title} onChange={(title) => { const columns = [...block.columns]; columns[index] = { ...column, title }; update({ columns }); }} /><div className="mt-2"><RichTextEditor compact value={column.html} onChange={(html) => { const columns = [...block.columns]; columns[index] = { ...column, html }; update({ columns }); }} /></div></div>)}</div> : null}
    {block.type === "footer" ? <p className="rounded-lg bg-gold-300/[0.06] p-3 text-[10px] leading-5 text-gold-100/65">The footer is locked to preserve support, account preferences, XauCloud identity, and trading-risk language.</p> : null}
    {!(["divider", "spacer", "footer"].includes(block.type)) ? <SelectSetting label="Block spacing" value={block.padding || "normal"} onChange={(padding) => update({ padding })} options={[["compact", "Compact"], ["normal", "Normal"], ["spacious", "Spacious"]]} /> : null}
    <details className="rounded-lg border border-white/[0.07] p-3"><summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wider text-white/40">Email theme</summary><div className="mt-4 space-y-3"><SelectSetting label="Content width" value={String(theme.width)} onChange={(width) => updateTheme({ width: Number(width) })} options={[["600", "600 px"], ["640", "640 px"], ["680", "680 px"]]} /><SelectSetting label="Accent" value={theme.accent} onChange={(accent) => updateTheme({ accent })} options={[["#D6B35A", "Signature gold"], ["#B88716", "Deep gold"]]} /><SelectSetting label="Outer background" value={theme.background} onChange={(background) => updateTheme({ background })} options={[["#08080A", "Black"], ["#111114", "Charcoal"], ["#19191D", "Soft charcoal"]]} /><SelectSetting label="Corner radius" value={String(theme.radius)} onChange={(radius) => updateTheme({ radius: Number(radius) })} options={[["0", "Square"], ["6", "Subtle"], ["10", "Standard"], ["14", "Soft"]]} /><SelectSetting label="Default spacing" value={theme.spacing} onChange={(spacing) => updateTheme({ spacing })} options={[["compact", "Compact"], ["normal", "Normal"], ["spacious", "Spacious"]]} /></div></details>
  </div>;
}

function panelTitle(mode) { return mode === "blocks" ? "Block library" : mode === "templates" ? "Templates" : "Saved drafts"; }

export default function EmailComposer({ api }) {
  const [campaign, setCampaign] = useState(() => {
    try { const saved = JSON.parse(window.localStorage.getItem(LOCAL_DRAFT_KEY) || "null"); return saved?.document ? saved : emptyCampaign(); } catch { return emptyCampaign(); }
  });
  const [selectedId, setSelectedId] = useState(() => campaign.document.blocks[0]?.id || null);
  const [leftMode, setLeftMode] = useState("blocks");
  const [mobilePanel, setMobilePanel] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [draftId, setDraftId] = useState(null);
  const [audienceMeta, setAudienceMeta] = useState({ segments: [], cap: 5000 });
  const [history, setHistory] = useState([]);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewTextVersion, setPreviewTextVersion] = useState("");
  const [previewDevice, setPreviewDevice] = useState("desktop");
  const [view, setView] = useState("design");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [testRecipient, setTestRecipient] = useState("");
  const [testModal, setTestModal] = useState(false);
  const [confirmModal, setConfirmModal] = useState(false);
  const [templateModal, setTemplateModal] = useState(false);
  const [historyPreview, setHistoryPreview] = useState(null);
  const [draftTitle, setDraftTitle] = useState("");

  const selectedBlock = campaign.document.blocks.find((block) => block.id === selectedId) || null;
  const selectedEmails = useMemo(() => campaign.selected_recipients.join("\n"), [campaign.selected_recipients]);
  const segment = audienceMeta.segments.find((item) => item.id === campaign.audience);
  const recipientCount = campaign.audience === "selected" ? campaign.selected_recipients.length : campaign.audience === "single" ? (/@/.test(campaign.to || "") ? 1 : 0) : segment?.count ?? 0;
  const canSend = Boolean(campaign.subject.trim() && campaign.document.blocks.length && (campaign.audience !== "selected" || campaign.selected_recipients.length) && (campaign.audience !== "single" || /@/.test(campaign.to || "")));
  const requestPayload = useMemo(() => ({
    subject: campaign.subject,
    preview_text: campaign.preview_text || null,
    sender_name: campaign.sender_name || null,
    reply_to: campaign.reply_to || null,
    document: campaign.document,
  }), [campaign]);

  const loadMeta = useCallback(async () => {
    const [audiences, templateData, draftData, logData] = await Promise.all([
      http.get(`${api}/admin/email/audience`), http.get(`${api}/admin/email/templates`),
      http.get(`${api}/admin/email/drafts`), http.get(`${api}/admin/email/log`),
    ]);
    setAudienceMeta(audiences.data);
    setTemplates(templateData.data.templates || []);
    setDrafts(draftData.data.drafts || []);
    setHistory(logData.data.entries || []);
    setCampaign((current) => ({ ...current, sender_name: current.sender_name || audiences.data.sender_name || "XauCloud", reply_to: current.reply_to || audiences.data.reply_to || "" }));
    setTestRecipient((current) => current || audiences.data.reply_to || "");
  }, [api]);

  useEffect(() => { loadMeta().catch((e) => setError(e.response?.data?.detail || "Could not load email tools.")); }, [loadMeta]);

  useEffect(() => {
    window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(campaign));
    if (!draftId || !campaign.subject.trim()) return undefined;
    const timer = window.setTimeout(() => {
      http.post(`${api}/admin/email/drafts`, { ...requestPayload, id: draftId, title: draftTitle || campaign.subject, audience: campaign.audience, to: campaign.to || "", selected_recipients: campaign.selected_recipients })
        .then((response) => { setStatus("Draft autosaved"); setDrafts((items) => [response.data, ...items.filter((item) => item.id !== response.data.id)]); })
        .catch(() => setStatus("Local autosave only"));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [api, campaign, draftId, draftTitle, requestPayload]);

  useEffect(() => {
    if (!campaign.subject.trim()) {
      setPreviewHtml("");
      setPreviewTextVersion("");
      return undefined;
    }
    const timer = window.setTimeout(() => {
      http.post(`${api}/admin/email/preview`, requestPayload)
        .then((response) => { setPreviewHtml(response.data.html || ""); setPreviewTextVersion(response.data.text || ""); })
        .catch((e) => { setPreviewHtml(""); if (campaign.subject.trim()) setError(typeof e.response?.data?.detail === "string" ? e.response.data.detail : "Preview could not be rendered."); });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [api, requestPayload, campaign.subject]);

  const patchCampaign = (patch) => setCampaign((current) => ({ ...current, ...patch }));
  const updateDocument = (updater) => setCampaign((current) => ({ ...current, document: typeof updater === "function" ? updater(current.document) : { ...current.document, ...updater } }));
  const updateBlock = (id, patch) => updateDocument((document) => ({ ...document, blocks: document.blocks.map((block) => block.id === id ? { ...block, ...patch } : block) }));
  const updateTheme = (patch) => updateDocument((document) => ({ ...document, theme: { ...document.theme, ...patch } }));
  const addBlock = (type) => { const block = createBlock(type); updateDocument((document) => ({ ...document, blocks: [...document.blocks, block] })); setSelectedId(block.id); setMobilePanel(null); setView("design"); };
  const moveBlock = (id, offset) => updateDocument((document) => { const blocks = [...document.blocks]; const index = blocks.findIndex((block) => block.id === id); const next = index + offset; if (index < 0 || next < 0 || next >= blocks.length) return document; [blocks[index], blocks[next]] = [blocks[next], blocks[index]]; return { ...document, blocks }; });
  const duplicateBlock = (id) => {
    const index = campaign.document.blocks.findIndex((block) => block.id === id);
    if (index < 0) return;
    const copy = { ...campaign.document.blocks[index], id: uid() };
    updateDocument((document) => {
      const blocks = [...document.blocks];
      blocks.splice(index + 1, 0, copy);
      return { ...document, blocks };
    });
    setSelectedId(copy.id);
  };
  const deleteBlock = (id) => {
    const blocks = campaign.document.blocks.filter((block) => block.id !== id);
    updateDocument((document) => ({ ...document, blocks }));
    if (selectedId === id) setSelectedId(blocks[0]?.id || null);
  };

  const useTemplate = (template) => {
    const document = JSON.parse(JSON.stringify(template.document));
    document.blocks = document.blocks.map((block) => ({ ...block, id: uid() }));
    setCampaign((current) => ({ ...current, subject: template.subject || "", preview_text: template.previewText || template.preview_text || "", document }));
    setSelectedId(document.blocks[0]?.id || null); setDraftId(null); setDraftTitle(""); setStatus(`${template.name} loaded`); setView("design");
  };

  const saveDraft = async () => {
    if (!campaign.subject.trim()) { setError("Add a subject before saving the draft."); return; }
    setBusy(true); setError("");
    try {
      const response = await http.post(`${api}/admin/email/drafts`, { ...requestPayload, id: draftId || undefined, title: draftTitle.trim() || campaign.subject, audience: campaign.audience, to: campaign.to || "", selected_recipients: campaign.selected_recipients });
      setDraftId(response.data.id); setDraftTitle(response.data.title); setDrafts((items) => [response.data, ...items.filter((item) => item.id !== response.data.id)]); setStatus("Draft saved");
    } catch (e) { setError(e.response?.data?.detail || "Draft could not be saved."); } finally { setBusy(false); }
  };
  const loadDraft = (draft) => { setCampaign({ subject: draft.subject || "", preview_text: draft.preview_text || "", sender_name: draft.sender_name || "XauCloud", reply_to: draft.reply_to || "", audience: draft.audience || "single", to: draft.to || "", selected_recipients: draft.selected_recipients || [], document: draft.document }); setDraftId(draft.id); setDraftTitle(draft.title); setSelectedId(draft.document?.blocks?.[0]?.id || null); setStatus("Draft loaded"); setMobilePanel(null); };
  const duplicateDraft = async (id) => { try { const response = await http.post(`${api}/admin/email/drafts/${id}/duplicate`); setDrafts((items) => [response.data, ...items]); setStatus("Draft duplicated"); } catch (e) { setError(e.response?.data?.detail || "Draft could not be duplicated."); } };
  const deleteDraft = async (id) => { if (!window.confirm("Delete this saved draft?")) return; try { await http.delete(`${api}/admin/email/drafts/${id}`); setDrafts((items) => items.filter((item) => item.id !== id)); if (draftId === id) { setDraftId(null); setDraftTitle(""); } } catch (e) { setError(e.response?.data?.detail || "Draft could not be deleted."); } };
  const saveTemplate = async () => { setBusy(true); setError(""); try { const response = await http.post(`${api}/admin/email/templates`, { ...requestPayload, name: draftTitle.trim() || campaign.subject || "Custom template", description: "Custom XauCloud template" }); setTemplates((items) => [...items, response.data]); setTemplateModal(false); setStatus("Custom template saved"); } catch (e) { setError(e.response?.data?.detail || "Template could not be saved."); } finally { setBusy(false); } };
  const deleteTemplate = async (id) => { if (!window.confirm("Delete this custom template?")) return; try { await http.delete(`${api}/admin/email/templates/${id}`); setTemplates((items) => items.filter((item) => item.id !== id)); } catch (e) { setError(e.response?.data?.detail || "Template could not be deleted."); } };

  const sendTest = async () => {
    setBusy(true); setError(""); setStatus("Sending test…");
    try { const response = await http.post(`${api}/admin/email/test`, { ...requestPayload, to: testRecipient.trim() || null }); setStatus(`Test sent to ${response.data.to}`); setTestModal(false); }
    catch (e) { setError(e.response?.data?.detail || "Test send failed."); setStatus(""); } finally { setBusy(false); }
  };
  const sendBroadcast = async () => {
    setBusy(true); setError(""); setStatus("Sending…");
    try {
      const response = await http.post(`${api}/admin/email/send`, { ...requestPayload, mode: campaign.audience === "single" ? "single" : "broadcast", audience: campaign.audience, to: campaign.to || null, selected_recipients: campaign.selected_recipients, confirm: campaign.audience !== "single" });
      setStatus(`Sent ${response.data.sent} of ${response.data.recipients}${response.data.failed ? ` · ${response.data.failed} failed` : ""}`); setConfirmModal(false); loadMeta();
    } catch (e) { setError(e.response?.data?.detail || "Broadcast failed."); setStatus(""); } finally { setBusy(false); }
  };

  const reuseHistory = (entry) => { if (!entry.document) return; setCampaign((current) => ({ ...current, subject: entry.subject || "", preview_text: entry.preview_text || "", sender_name: entry.sender_name || current.sender_name, reply_to: entry.reply_to || current.reply_to, audience: entry.audience || "single", to: "", selected_recipients: [], document: entry.document })); setSelectedId(entry.document.blocks?.[0]?.id || null); setDraftId(null); setStatus("Previous campaign loaded as a new draft"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const viewHistory = async (entry) => {
    if (!entry.document) return;
    setBusy(true); setError("");
    try {
      const response = await http.post(`${api}/admin/email/preview`, {
        subject: entry.subject,
        preview_text: entry.preview_text || null,
        sender_name: entry.sender_name || null,
        reply_to: entry.reply_to || null,
        document: entry.document,
      });
      setHistoryPreview({ entry, html: response.data.html || "", text: response.data.text || "" });
    } catch (e) { setError(e.response?.data?.detail || "Campaign preview could not be loaded."); } finally { setBusy(false); }
  };

  const leftContent = <><div className="mb-3 flex rounded-lg bg-white/[0.04] p-1">{[["blocks", "Blocks"], ["templates", "Templates"], ["drafts", "Drafts"]].map(([id, name]) => <button key={id} type="button" onClick={() => setLeftMode(id)} className={`flex-1 rounded-md px-1 py-1.5 text-[9px] font-bold ${leftMode === id ? "bg-gold-300 text-black" : "text-white/40"}`}>{name}</button>)}</div>{leftMode === "blocks" ? <BlockLibrary addBlock={addBlock} /> : leftMode === "templates" ? <TemplateLibrary templates={templates} applyTemplate={useTemplate} deleteTemplate={deleteTemplate} /> : <DraftLibrary drafts={drafts} loadDraft={loadDraft} duplicateDraft={duplicateDraft} deleteDraft={deleteDraft} />}</>;

  return (
    <div className="space-y-4" data-testid="admin-email-tab">
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0d11] p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><div className="font-mono text-[9px] uppercase tracking-[.2em] text-gold-300/70">XauCloud Broadcast Studio</div><h2 className="mt-1 text-xl font-extrabold tracking-tight text-white">Email composer</h2><p className="mt-1 text-[11px] text-white/35">Visual editing, exact recipient preview, and the existing production SMTP pipeline.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setMobilePanel("left")} className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-bold text-white/60 xl:hidden">BLOCKS</button><button type="button" onClick={() => setMobilePanel("right")} className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-bold text-white/60 xl:hidden">STYLE</button><button type="button" onClick={saveDraft} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-bold text-white/70"><FloppyDisk size={13} /> SAVE DRAFT</button><button type="button" onClick={() => { setDraftTitle(draftTitle || campaign.subject); setTemplateModal(true); }} className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-bold text-white/70">SAVE TEMPLATE</button></div></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><Field label="Subject"><input data-testid="email-subject" className={INPUT} value={campaign.subject} onChange={(e) => patchCampaign({ subject: e.target.value })} placeholder="A short, clear subject" maxLength={300} /></Field><Field label="Preview text / preheader"><input className={INPUT} value={campaign.preview_text} onChange={(e) => patchCampaign({ preview_text: e.target.value })} placeholder="Inbox preview text" maxLength={300} /></Field><Field label="Sender name"><input className={INPUT} value={campaign.sender_name} onChange={(e) => patchCampaign({ sender_name: e.target.value })} maxLength={80} /></Field><Field label="Reply-to"><input className={INPUT} type="email" value={campaign.reply_to} onChange={(e) => patchCampaign({ reply_to: e.target.value })} placeholder="support@xaucloud.io" /></Field></div>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]"><div className="grid gap-3 sm:grid-cols-2"><Field label="Audience"><select className={INPUT} value={campaign.audience} onChange={(e) => patchCampaign({ audience: e.target.value })}>{audienceMeta.segments.map((item) => <option key={item.id} value={item.id}>{item.label}{item.count !== null ? ` · ${item.count}` : ""}</option>)}</select></Field>{campaign.audience === "selected" ? <Field label="Selected emails (one per line)"><textarea className={`${INPUT} min-h-20`} value={selectedEmails} onChange={(e) => patchCampaign({ selected_recipients: [...new Set(e.target.value.split(/[\n,]/).map((value) => value.trim().toLowerCase()).filter(Boolean))] })} placeholder="customer@example.com" /></Field> : campaign.audience === "single" ? <Field label="Recipient email"><input className={INPUT} type="email" value={campaign.to || ""} onChange={(e) => patchCampaign({ to: e.target.value })} placeholder="customer@example.com" /></Field> : <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2"><div className={LABEL}>Recipient estimate</div><div className="text-lg font-black text-white">{recipientCount}</div><div className="text-[9px] text-white/30">{segment?.description || "Select an audience"}</div></div>}</div><div className="flex items-end gap-2"><button type="button" onClick={() => setTestModal(true)} disabled={!campaign.subject.trim()} className="flex h-10 items-center gap-2 rounded-lg border border-gold-300/25 bg-gold-300/[0.06] px-4 text-[10px] font-black text-gold-200 disabled:opacity-30"><Envelope size={13} /> SEND TEST</button><button type="button" onClick={() => setConfirmModal(true)} disabled={!canSend} className="h-10 rounded-lg bg-gold-300 px-4 text-[10px] font-black text-black disabled:opacity-30">REVIEW & SEND</button></div></div>
        {(status || error) ? <div className={`mt-3 rounded-lg border px-3 py-2 text-[10px] ${error ? "border-red-400/20 bg-red-500/10 text-red-300" : "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"}`}>{error || status}</div> : null}
      </div>

      <div className="grid min-h-[760px] gap-4 xl:grid-cols-[230px_minmax(0,1fr)_270px]">
        <aside className="hidden rounded-2xl border border-white/[0.08] bg-[#0c0d11] p-3 xl:block"><div className="mb-3 font-mono text-[9px] uppercase tracking-[.16em] text-white/30">Build</div>{leftContent}</aside>
        <section className="min-w-0 rounded-2xl border border-white/[0.08] bg-[#0c0d11]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] p-3"><div className="flex rounded-lg bg-white/[0.04] p-1">{[["design", "Design"], ["preview", "Preview"], ["source", "HTML"]].map(([id, name]) => <button key={id} type="button" onClick={() => setView(id)} className={`rounded-md px-3 py-1.5 text-[9px] font-bold ${view === id ? "bg-white/[0.1] text-white" : "text-white/35"}`}>{name}</button>)}</div>{view === "preview" ? <div className="flex rounded-lg bg-white/[0.04] p-1">{[["desktop", Desktop], ["mobile", DeviceMobile]].map(([id, Icon]) => <button key={id} type="button" onClick={() => setPreviewDevice(id)} aria-label={`${id} preview`} className={`rounded-md p-1.5 ${previewDevice === id ? "bg-gold-300 text-black" : "text-white/40"}`}><Icon size={14} /></button>)}</div> : <span className="text-[9px] text-white/25">{campaign.document.blocks.length} blocks · {draftId ? "server autosave on" : "local autosave on"}</span>}</div>
          {view === "design" ? <div className="mx-auto max-w-3xl space-y-2 p-3 sm:p-5">{campaign.document.blocks.map((block, index) => <CanvasBlock key={block.id} block={block} selected={block.id === selectedId} onSelect={setSelectedId} onUpdate={updateBlock} onMove={moveBlock} onDuplicate={duplicateBlock} onDelete={deleteBlock} isFirst={index === 0} isLast={index === campaign.document.blocks.length - 1} />)}<button type="button" onClick={() => { setLeftMode("blocks"); setMobilePanel("left"); }} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 py-4 text-[10px] font-bold text-white/30 hover:border-gold-300/30 hover:text-gold-200"><Plus size={13} /> ADD CONTENT BLOCK</button></div> : null}
          {view === "preview" ? <div className="p-3 sm:p-5">{previewHtml ? <PreviewFrame html={previewHtml} device={previewDevice} /> : <div className="flex h-64 items-center justify-center text-[11px] text-white/30">Add valid content to generate the exact recipient preview.</div>}</div> : null}
          {view === "source" ? <div className="p-4"><div className="mb-3 rounded-lg border border-gold-300/15 bg-gold-300/[0.05] p-3 text-[10px] leading-5 text-gold-100/60"><BracketsCurly size={15} className="mr-2 inline" />Read-only sanitized source from the same renderer used for delivery. Visual editing remains authoritative.</div><textarea readOnly value={previewHtml} className="h-[590px] w-full resize-none rounded-xl border border-white/[0.08] bg-black/40 p-4 font-mono text-[10px] leading-5 text-white/45 outline-none" /><details className="mt-3"><summary className="cursor-pointer text-[10px] font-bold text-white/40">Plain-text fallback</summary><pre className="mt-2 whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-[10px] leading-5 text-white/45">{previewTextVersion}</pre></details></div> : null}
        </section>
        <aside className="hidden rounded-2xl border border-white/[0.08] bg-[#0c0d11] p-4 xl:block"><BlockSettings block={selectedBlock} updateBlock={updateBlock} theme={campaign.document.theme} updateTheme={updateTheme} /></aside>
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0d11]"><div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5"><div><h3 className="text-[11px] font-bold uppercase tracking-[.15em] text-white/45">Email history</h3><p className="mt-1 text-[9px] text-white/25">Delivery counts only. Open and click analytics are not collected.</p></div></div><div className="divide-y divide-white/[0.05]">{history.length ? history.map((entry) => <div key={entry.id || entry.at} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div className="min-w-0"><div className="truncate text-[12px] font-bold text-white/75">{entry.subject}</div><div className="mt-1 text-[9px] text-white/30">{new Date(entry.at).toLocaleString()} · {entry.audience || entry.mode} · by {entry.creator || entry.admin_email || "Admin"}</div></div><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-[9px] font-bold ${entry.failed ? "bg-gold-300/10 text-gold-200" : "bg-emerald-400/10 text-emerald-300"}`}>{entry.sent}/{entry.recipients} sent</span>{entry.document ? <><button type="button" onClick={() => viewHistory(entry)} disabled={busy} className="rounded-lg border border-white/10 px-2 py-1.5 text-[9px] font-bold text-white/50">VIEW</button><button type="button" onClick={() => reuseHistory(entry)} className="rounded-lg border border-white/10 px-2 py-1.5 text-[9px] font-bold text-white/50">DUPLICATE</button></> : null}</div></div>) : <div className="p-8 text-center text-[11px] text-white/30">No sent campaigns yet.</div>}</div></div>

      {mobilePanel ? <Modal title={mobilePanel === "left" ? panelTitle(leftMode) : "Block settings"} onClose={() => setMobilePanel(null)}>{mobilePanel === "left" ? leftContent : <BlockSettings block={selectedBlock} updateBlock={updateBlock} theme={campaign.document.theme} updateTheme={updateTheme} />}</Modal> : null}
      {testModal ? <Modal title="Send exact test email" onClose={() => setTestModal(false)}><p className="mb-4 text-[11px] leading-5 text-white/40">This sends the exact HTML and plain-text content shown in preview through the configured production SMTP provider. It never sends to the selected audience.</p><Field label="Test recipient"><input className={INPUT} type="email" value={testRecipient} onChange={(e) => setTestRecipient(e.target.value)} placeholder="you@example.com" /></Field><button type="button" disabled={busy || !/@/.test(testRecipient)} onClick={sendTest} className="mt-5 w-full rounded-lg bg-gold-300 py-3 text-[11px] font-black text-black disabled:opacity-30">{busy ? "SENDING…" : "SEND TEST EMAIL"}</button></Modal> : null}
      {confirmModal ? <Modal title="Confirm broadcast" onClose={() => setConfirmModal(false)}><div className="space-y-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">{[["Subject", campaign.subject], ["Audience", segment?.label || campaign.audience], ["Recipient count", String(recipientCount)], ["Sender", campaign.sender_name], ["Preview text", campaign.preview_text || "None"]].map(([label, value]) => <div key={label} className="grid grid-cols-[110px_1fr] gap-3 text-[11px]"><span className="text-white/32">{label}</span><span className="break-words font-semibold text-white/75">{value}</span></div>)}</div><div className="mt-4 flex items-start gap-2 rounded-lg border border-gold-300/20 bg-gold-300/[0.06] p-3 text-[10px] leading-5 text-gold-100/65"><Warning size={15} className="mt-0.5 flex-none" />A broadcast cannot be unsent. The server will resolve and validate this audience again at send time.</div><button type="button" disabled={busy || recipientCount < 1} onClick={sendBroadcast} className="mt-5 w-full rounded-lg bg-gold-300 py-3 text-[11px] font-black text-black disabled:opacity-30">{busy ? "SENDING…" : `SEND TO ${recipientCount} RECIPIENT${recipientCount === 1 ? "" : "S"}`}</button></Modal> : null}
      {templateModal ? <Modal title="Save as custom template" onClose={() => setTemplateModal(false)}><Field label="Template name"><input className={INPUT} value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="My XauCloud template" /></Field><button type="button" disabled={busy || !draftTitle.trim()} onClick={saveTemplate} className="mt-5 w-full rounded-lg bg-gold-300 py-3 text-[11px] font-black text-black disabled:opacity-30">SAVE TEMPLATE</button></Modal> : null}
      {historyPreview ? <Modal wide title={historyPreview.entry.subject || "Sent campaign"} onClose={() => setHistoryPreview(null)}><PreviewFrame html={historyPreview.html} device="desktop" /><details className="mt-3"><summary className="cursor-pointer text-[10px] font-bold text-white/45">Plain-text fallback</summary><pre className="mt-2 whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-[10px] leading-5 text-white/45">{historyPreview.text}</pre></details></Modal> : null}
    </div>
  );
}
