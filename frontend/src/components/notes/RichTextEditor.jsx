import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
  List,
  ListOrdered,
  Quote,
  Minus,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Link as LinkIcon,
  Unlink,
  Undo2,
  Redo2,
  Palette,
  Highlighter,
  Type,
  Maximize2,
  Minimize2,
  Check,
} from 'lucide-react';

export const FONT_FAMILIES = [
  { id: 'literary-serif', label: 'Literary Serif', value: "'Cinzel', 'Playfair Display', serif" },
  { id: 'classic-serif', label: 'Classic Serif', value: "'Merriweather', 'Georgia', serif" },
  { id: 'modern-sans', label: 'Modern Sans', value: "'Inter', -apple-system, sans-serif" },
  { id: 'clean-sans', label: 'Clean Sans', value: "'Segoe UI', Roboto, sans-serif" },
  { id: 'monospace', label: 'Monospace', value: "'JetBrains Mono', 'Fira Code', monospace" },
  { id: 'handwritten', label: 'Handwritten', value: "'Caveat', 'Dancing Script', cursive" },
];

export const FONT_SIZES = [
  { label: 'Small (14px)', value: '14px' },
  { label: 'Normal (16px)', value: '16px' },
  { label: 'Medium (18px)', value: '18px' },
  { label: 'Large (20px)', value: '20px' },
  { label: 'Reading (22px)', value: '22px' },
];

export const TEXT_COLORS = [
  { label: 'Default', value: 'inherit' },
  { label: 'Warm Brown', value: '#c29b74' },
  { label: 'Muted Gold', value: '#e7c18a' },
  { label: 'Forest Green', value: '#4e9a7e' },
  { label: 'Burgundy', value: '#a84b5a' },
  { label: 'Muted Blue', value: '#6ca0dc' },
];

export const HIGHLIGHT_COLORS = [
  { label: 'None', value: 'none' },
  { label: 'Soft Yellow', value: '#fef08a' },
  { label: 'Sage', value: '#bbf7d0' },
  { label: 'Lavender', value: '#e9d5ff' },
  { label: 'Peach', value: '#fed7aa' },
  { label: 'Light Blue', value: '#bfdbfe' },
];

export const APPEARANCE_THEMES = [
  { id: 'classic-paper', label: 'Classic Paper', description: 'Warm ivory paper & subtle borders' },
  { id: 'midnight', label: 'Midnight', description: 'Deep navy background & gold accents' },
  { id: 'pure-minimal', label: 'Pure Minimal', description: 'Crisp monochrome & clean typography' },
];

export default function RichTextEditor({
  initialRichContent,
  initialPlainText,
  onChange,
  appearance = 'classic-paper',
  onAppearanceChange,
  typography,
  onTypographyChange,
  placeholder = 'Begin your personal entry here… thoughts, reflections, ideas or memories…',
  readOnly = false,
}) {
  const [selectedFont, setSelectedFont] = useState(typography?.fontFamily || FONT_FAMILIES[0].value);
  const [selectedFontSize, setSelectedFontSize] = useState(typography?.fontSize || '16px');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [customHex, setCustomHex] = useState('');
  const [hexError, setHexError] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const containerRef = useRef(null);

  // Parse initial content safely: prefer structured JSON if available, fallback to markdown/plaintext
  const getInitialContent = () => {
    if (initialRichContent && typeof initialRichContent === 'object' && initialRichContent.type === 'doc') {
      return initialRichContent;
    }
    if (initialPlainText && typeof initialPlainText === 'string' && initialPlainText.trim().length > 0) {
      // Split into paragraphs for initial document structure
      const paragraphs = initialPlainText.split('\n\n').filter(Boolean);
      if (paragraphs.length === 0) return { type: 'doc', content: [{ type: 'paragraph' }] };
      return {
        type: 'doc',
        content: paragraphs.map((p) => ({
          type: 'paragraph',
          content: [{ type: 'text', text: p.replace(/\n/g, ' ') }],
        })),
      };
    }
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
    ],
    content: getInitialContent(),
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      if (onChange) {
        const json = editor.getJSON();
        const text = editor.getText();
        const html = editor.getHTML();
        onChange({
          richContent: json,
          plainText: text,
          html,
        });
      }
    },
  });

  // Keep editor content in sync when a different note is selected
  const lastLoadedNoteRef = useRef(null);
  useEffect(() => {
    if (!editor) return;
    const currentDoc = getInitialContent();
    const docString = JSON.stringify(currentDoc);
    if (lastLoadedNoteRef.current !== docString) {
      lastLoadedNoteRef.current = docString;
      editor.commands.setContent(currentDoc, false);
    }
  }, [initialRichContent, initialPlainText, editor]);

  // Handle typography updates
  const handleFontChange = (fontValue) => {
    setSelectedFont(fontValue);
    if (onTypographyChange) {
      onTypographyChange({
        ...typography,
        fontFamily: fontValue,
      });
    }
  };

  const handleFontSizeChange = (sizeValue) => {
    setSelectedFontSize(sizeValue);
    if (onTypographyChange) {
      onTypographyChange({
        ...typography,
        fontSize: sizeValue,
      });
    }
  };

  const handleApplyColor = (colorValue) => {
    if (colorValue === 'inherit') {
      editor.chain().focus().unsetColor().run();
    } else {
      editor.chain().focus().setColor(colorValue).run();
    }
    setShowColorPicker(false);
  };

  const handleApplyCustomHex = () => {
    const trimmed = customHex.trim();
    if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(trimmed)) {
      setHexError(false);
      handleApplyColor(trimmed);
      setCustomHex('');
    } else {
      setHexError(true);
    }
  };

  const handleApplyHighlight = (colorValue) => {
    if (colorValue === 'none') {
      editor.chain().focus().unsetHighlight().run();
    } else {
      editor.chain().focus().setHighlight({ color: colorValue }).run();
    }
    setShowHighlightPicker(false);
  };

  const handleSetLink = () => {
    if (!linkUrl.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      let finalUrl = linkUrl.trim();
      if (!/^https?:\/\//i.test(finalUrl)) {
        finalUrl = `https://${finalUrl}`;
      }
      editor.chain().focus().extendMarkRange('link').setLink({ href: finalUrl }).run();
    }
    setShowLinkInput(false);
    setLinkUrl('');
  };

  if (!editor) return null;

  return (
    <div
      ref={containerRef}
      className={`aks-editor-wrapper aks-editor-theme--${appearance} ${
        isFullscreen ? 'aks-editor-fullscreen' : ''
      }`}
      style={{
        '--editor-font-family': selectedFont,
        '--editor-font-size': selectedFontSize,
      }}
    >
      {/* ── Rich Formatting Toolbar ────────────────────────────────────── */}
      <div className="aks-editor-toolbar" role="toolbar" aria-label="Text Formatting">
        {/* Undo / Redo */}
        <div className="aks-toolbar-group">
          <button
            type="button"
            className="aks-tool-btn"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title="Undo (Cmd+Z)"
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            className="aks-tool-btn"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title="Redo (Cmd+Shift+Z)"
          >
            <Redo2 size={15} />
          </button>
        </div>

        <div className="aks-toolbar-divider" />

        {/* Headings & Paragraph Selector */}
        <div className="aks-toolbar-group">
          <button
            type="button"
            className={`aks-tool-btn ${editor.isActive('paragraph') ? 'active' : ''}`}
            onClick={() => editor.chain().focus().setParagraph().run()}
            title="Paragraph"
          >
            <Pilcrow size={14} />
          </button>
          <button
            type="button"
            className={`aks-tool-btn ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            title="Heading 1"
          >
            <Heading1 size={15} />
          </button>
          <button
            type="button"
            className={`aks-tool-btn ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            title="Heading 2"
          >
            <Heading2 size={15} />
          </button>
          <button
            type="button"
            className={`aks-tool-btn ${editor.isActive('heading', { level: 3 }) ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            title="Heading 3"
          >
            <Heading3 size={15} />
          </button>
        </div>

        <div className="aks-toolbar-divider" />

        {/* Inline Marks: Bold, Italic, Underline, Strikethrough */}
        <div className="aks-toolbar-group">
          <button
            type="button"
            className={`aks-tool-btn ${editor.isActive('bold') ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Bold (Cmd+B)"
          >
            <BoldIcon size={14} />
          </button>
          <button
            type="button"
            className={`aks-tool-btn ${editor.isActive('italic') ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Italic (Cmd+I)"
          >
            <ItalicIcon size={14} />
          </button>
          <button
            type="button"
            className={`aks-tool-btn ${editor.isActive('underline') ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            title="Underline (Cmd+U)"
          >
            <UnderlineIcon size={14} />
          </button>
          <button
            type="button"
            className={`aks-tool-btn ${editor.isActive('strike') ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            title="Strikethrough"
          >
            <Strikethrough size={14} />
          </button>
        </div>

        <div className="aks-toolbar-divider" />

        {/* Text Alignment */}
        <div className="aks-toolbar-group">
          <button
            type="button"
            className={`aks-tool-btn ${editor.isActive({ textAlign: 'left' }) ? 'active' : ''}`}
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            title="Align Left"
          >
            <AlignLeft size={14} />
          </button>
          <button
            type="button"
            className={`aks-tool-btn ${editor.isActive({ textAlign: 'center' }) ? 'active' : ''}`}
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            title="Align Center"
          >
            <AlignCenter size={14} />
          </button>
          <button
            type="button"
            className={`aks-tool-btn ${editor.isActive({ textAlign: 'right' }) ? 'active' : ''}`}
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
            title="Align Right"
          >
            <AlignRight size={14} />
          </button>
          <button
            type="button"
            className={`aks-tool-btn ${editor.isActive({ textAlign: 'justify' }) ? 'active' : ''}`}
            onClick={() => editor.chain().focus().setTextAlign('justify').run()}
            title="Justify Text"
          >
            <AlignJustify size={14} />
          </button>
        </div>

        <div className="aks-toolbar-divider" />

        {/* Lists & Quotes */}
        <div className="aks-toolbar-group">
          <button
            type="button"
            className={`aks-tool-btn ${editor.isActive('bulletList') ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            title="Bullet List"
          >
            <List size={14} />
          </button>
          <button
            type="button"
            className={`aks-tool-btn ${editor.isActive('orderedList') ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            title="Numbered List"
          >
            <ListOrdered size={14} />
          </button>
          <button
            type="button"
            className={`aks-tool-btn ${editor.isActive('blockquote') ? 'active' : ''}`}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            title="Blockquote"
          >
            <Quote size={14} />
          </button>
          <button
            type="button"
            className="aks-tool-btn"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Horizontal Divider"
          >
            <Minus size={14} />
          </button>
        </div>

        <div className="aks-toolbar-divider" />

        {/* Links */}
        <div className="aks-toolbar-group relative">
          <button
            type="button"
            className={`aks-tool-btn ${editor.isActive('link') ? 'active' : ''}`}
            onClick={() => {
              if (editor.isActive('link')) {
                editor.chain().focus().unsetLink().run();
              } else {
                setShowLinkInput(!showLinkInput);
              }
            }}
            title={editor.isActive('link') ? 'Remove Link' : 'Add Link'}
          >
            {editor.isActive('link') ? <Unlink size={14} /> : <LinkIcon size={14} />}
          </button>

          {showLinkInput && (
            <div className="aks-toolbar-popover aks-link-popover">
              <input
                type="url"
                placeholder="https://example.com"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSetLink();
                  if (e.key === 'Escape') setShowLinkInput(false);
                }}
                autoFocus
              />
              <button type="button" onClick={handleSetLink}>
                Add
              </button>
            </div>
          )}
        </div>

        <div className="aks-toolbar-divider" />

        {/* Colors & Highlights */}
        <div className="aks-toolbar-group relative">
          {/* Text Color Dropdown */}
          <button
            type="button"
            className="aks-tool-btn"
            onClick={() => {
              setShowColorPicker(!showColorPicker);
              setShowHighlightPicker(false);
            }}
            title="Text Color"
          >
            <Palette size={14} />
          </button>

          {showColorPicker && (
            <div className="aks-toolbar-popover aks-palette-popover">
              <div className="aks-popover-title">Text Color</div>
              <div className="aks-color-swatches">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className="aks-swatch-btn"
                    style={{ background: c.value === 'inherit' ? '#e2e8f0' : c.value }}
                    onClick={() => handleApplyColor(c.value)}
                    title={c.label}
                  />
                ))}
              </div>
              <div className="aks-custom-hex-row">
                <input
                  type="text"
                  placeholder="#e7c18a"
                  value={customHex}
                  onChange={(e) => {
                    setCustomHex(e.target.value);
                    setHexError(false);
                  }}
                  className={hexError ? 'error' : ''}
                />
                <button type="button" onClick={handleApplyCustomHex}>
                  Apply
                </button>
              </div>
            </div>
          )}

          {/* Highlight Color Dropdown */}
          <button
            type="button"
            className="aks-tool-btn"
            onClick={() => {
              setShowHighlightPicker(!showHighlightPicker);
              setShowColorPicker(false);
            }}
            title="Text Highlight"
          >
            <Highlighter size={14} />
          </button>

          {showHighlightPicker && (
            <div className="aks-toolbar-popover aks-palette-popover">
              <div className="aks-popover-title">Highlight Color</div>
              <div className="aks-color-swatches">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className={`aks-swatch-btn ${c.value === 'none' ? 'aks-swatch-none' : ''}`}
                    style={{ background: c.value === 'none' ? 'transparent' : c.value }}
                    onClick={() => handleApplyHighlight(c.value)}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="aks-toolbar-spacer" />

        {/* ── Typography & Appearance Controls ────────────────────────── */}
        <div className="aks-toolbar-group">
          {/* Font Family Selector */}
          <select
            className="aks-tool-select"
            value={selectedFont}
            onChange={(e) => handleFontChange(e.target.value)}
            title="Font Family"
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f.id} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>

          {/* Font Size Selector */}
          <select
            className="aks-tool-select"
            value={selectedFontSize}
            onChange={(e) => handleFontSizeChange(e.target.value)}
            title="Font Size"
          >
            {FONT_SIZES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          {/* Editor Appearance Theme */}
          <select
            className="aks-tool-select"
            value={appearance}
            onChange={(e) => onAppearanceChange && onAppearanceChange(e.target.value)}
            title="Editor Appearance Theme"
          >
            {APPEARANCE_THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            className="aks-tool-btn"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Writing Mode'}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* ── Editor Canvas Content ────────────────────────────────────── */}
      <div className="aks-editor-canvas-container">
        <EditorContent editor={editor} className="aks-editor-prosemirror" />
      </div>
    </div>
  );
}

