import { useRef, useState, type ReactNode } from 'react';
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Sigma,
  Beaker,
  Table2,
  ImagePlus,
  Link2,
  Eraser,
  X,
  Upload,
} from 'lucide-react';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  charCount: number;
  maxChars: number;
}

function TBtn({
  onClick,
  children,
  title,
  active,
}: {
  onClick: () => void;
  children: ReactNode;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-[13px] transition ${
        active
          ? 'bg-blue-100 text-blue-700'
          : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
      }`}
    >
      {children}
    </button>
  );
}

export default function RichTextEditor({ value, onChange, charCount, maxChars }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showImageUpload, setShowImageUpload] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [showTablePicker, setShowTablePicker] = useState(false);

  const execCmd = (command: string, val?: string) => {
    document.execCommand(command, false, val || null);
    editorRef.current?.focus();
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  const handleImageUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => {
      const files = input.files;
      if (!files) return;
      Array.from(files).forEach((file) => {
        const reader = new FileReader();
        reader.onload = (e) => execCmd('insertImage', e.target?.result as string);
        reader.readAsDataURL(file);
      });
    };
    input.click();
    setShowImageUpload(false);
  };

  const handleLinkInsert = () => {
    if (linkUrl) {
      execCmd('createLink', linkUrl);
      setLinkUrl('');
      setShowLinkInput(false);
    }
  };

  const handleTableInsert = (cols: number, rows: number) => {
    let html = '<table style="border-collapse:collapse;width:100%;">';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) html += '<td style="border:1px solid #e2e8f0;padding:8px;"></td>';
      html += '</tr>';
    }
    html += '</table>';
    execCmd('insertHTML', html);
    setShowTablePicker(false);
  };

  const groups: ReactNode[] = [];
  const btns = [
    [{ onClick: () => execCmd('bold'), title: 'Bold', icon: <Bold className="h-3.5 w-3.5" /> },
     { onClick: () => execCmd('italic'), title: 'Italic', icon: <Italic className="h-3.5 w-3.5" /> },
     { onClick: () => execCmd('underline'), title: 'Underline', icon: <Underline className="h-3.5 w-3.5" /> }],
    [{ onClick: () => execCmd('insertUnorderedList'), title: 'Bullets', icon: <List className="h-3.5 w-3.5" /> },
     { onClick: () => execCmd('insertOrderedList'), title: 'Numbers', icon: <ListOrdered className="h-3.5 w-3.5" /> }],
    [{ onClick: () => execCmd('justifyLeft'), title: 'Left', icon: <AlignLeft className="h-3.5 w-3.5" /> },
     { onClick: () => execCmd('justifyCenter'), title: 'Center', icon: <AlignCenter className="h-3.5 w-3.5" /> },
     { onClick: () => execCmd('justifyRight'), title: 'Right', icon: <AlignRight className="h-3.5 w-3.5" /> }],
    [{ onClick: () => execCmd('insertHTML', '<span style="background:#eff6ff;padding:2px 8px;border-radius:6px;font-family:serif;">E = mc&sup2;</span>'), title: 'Equation', icon: <Sigma className="h-3.5 w-3.5" /> },
     { onClick: () => execCmd('insertHTML', '<span style="background:#f0fdf4;padding:2px 8px;border-radius:6px;font-family:serif;">H&#8322;SO&#8324;</span>'), title: 'Chemistry', icon: <Beaker className="h-3.5 w-3.5" /> }],
    [{ onClick: () => setShowTablePicker(!showTablePicker), title: 'Table', icon: <Table2 className="h-3.5 w-3.5" /> },
     { onClick: () => setShowImageUpload(true), title: 'Image', icon: <ImagePlus className="h-3.5 w-3.5" /> },
     { onClick: () => setShowLinkInput(!showLinkInput), title: 'Link', icon: <Link2 className="h-3.5 w-3.5" /> }],
  ];

  btns.forEach((group, gi) => {
    if (gi > 0) groups.push(<div key={`s${gi}`} className="mx-0.5 h-5 w-px bg-slate-200" />);
    groups.push(
      <div key={`g${gi}`} className="flex items-center gap-0.5">
        {group.map((b, bi) => (
          <TBtn key={bi} onClick={b.onClick} title={b.title}>{b.icon}</TBtn>
        ))}
      </div>
    );
  });

  const pct = Math.min((charCount / maxChars) * 100, 100);

  return (
    <div className="overflow-hidden rounded-xl">
      {/* Floating Toolbar */}
      <div className="flex items-center gap-1 border-b border-slate-100 bg-[#fafbfc] px-3 py-1.5">
        {groups}
        <div className="flex-1" />
        <TBtn onClick={() => { if (editorRef.current) { editorRef.current.innerHTML = ''; onChange(''); } }} title="Clear">
          <Eraser className="h-3.5 w-3.5 text-red-400" />
        </TBtn>
      </div>

      {/* Link Input Bar */}
      {showLinkInput && (
        <div className="flex items-center gap-2 border-b border-slate-100 bg-[#fafbfc] px-3 py-2">
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="Paste URL..."
            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-700 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
            onKeyDown={(e) => e.key === 'Enter' && handleLinkInsert()}
          />
          <button type="button" onClick={handleLinkInsert} className="rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700">Insert</button>
          <button type="button" onClick={() => setShowLinkInput(false)} className="rounded p-1 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Image Upload Bar */}
      {showImageUpload && (
        <div className="flex items-center gap-2 border-b border-slate-100 bg-[#fafbfc] px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-500 hover:border-blue-300 hover:text-blue-600">
            <Upload className="h-3 w-3" />
            Upload
            <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
          </label>
          <button type="button" onClick={() => setShowImageUpload(false)} className="rounded p-1 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Table Picker */}
      {showTablePicker && (
        <div className="absolute top-full left-0 z-30 mt-2 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <p className="mb-2 text-[10px] font-bold uppercase text-slate-400">Table Size</p>
          <div className="flex gap-3">
            <div className="space-y-1">
              {[2, 3, 4, 5].map((c) => (
                <button key={c} type="button" onClick={() => handleTableInsert(c, 3)} className="block w-full rounded-lg px-3 py-1 text-[11px] font-medium text-slate-600 hover:bg-blue-50 hover:text-blue-600">{c} col</button>
              ))}
            </div>
            <div className="w-px bg-slate-100" />
            <div className="space-y-1">
              {[2, 3, 4, 5].map((r) => (
                <button key={r} type="button" onClick={() => handleTableInsert(3, r)} className="block w-full rounded-lg px-3 py-1 text-[11px] font-medium text-slate-600 hover:bg-blue-50 hover:text-blue-600">{r} row</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Content Area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className="min-h-[320px] max-h-[560px] overflow-y-auto px-6 py-5 text-[14px] leading-[1.8] text-slate-800 outline-none empty:before:text-slate-300 empty:before:content-['Type_your_question_here...']"
        role="textbox"
        aria-label="Question editor"
        aria-multiline="true"
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        dangerouslySetInnerHTML={{ __html: value }}
      />

      {/* Footer Strip */}
      <div className="flex items-center justify-between border-t border-slate-100 bg-[#fafbfc] px-4 py-2">
        <span className="text-[10px] text-slate-300">Rich text editor</span>
        <div className="flex items-center gap-2">
          <div className="h-1 w-16 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all ${pct > 95 ? 'bg-red-400' : pct > 80 ? 'bg-amber-400' : 'bg-emerald-400'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-400">{charCount.toLocaleString()} / {maxChars.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
