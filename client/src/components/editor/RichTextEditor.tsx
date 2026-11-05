import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';
import { Markdown } from 'tiptap-markdown';
import { createEchoGuard } from '@/api/realtime';

interface Props {
  value: string;
  onChange(markdown: string): void;
  ariaLabel: string;
}

export function RichTextEditor({ value, onChange, ariaLabel }: Props) {
  const echo = useRef(createEchoGuard()).current;
  const change = useRef(onChange);
  change.current = onChange;

  const editor = useEditor({
    extensions: [StarterKit, Markdown.configure({ html: false, breaks: false, transformPastedText: true })],
    content: value,
    editorProps: { attributes: { class: 'prose-book', 'aria-label': ariaLabel, role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate({ editor: e }) {
      const storage = e.storage as unknown as { markdown: { getMarkdown(): string } };
      const md = storage.markdown.getMarkdown();
      echo.sent(md);
      change.current(md);
    },
  });

  useEffect(() => {
    if (!editor || echo.isEcho(value)) return;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, echo, value]);

  return <EditorContent editor={editor} />;
}
