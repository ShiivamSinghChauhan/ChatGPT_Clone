import { Children, isValidElement, memo, useRef, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/format";
import { CopyButton } from "./ui";

function CodeBlock({ children, node, ...rest }: ComponentPropsWithoutRef<"pre"> & ExtraProps) {
  void node;
  const ref = useRef<HTMLPreElement>(null);
  const child = Children.toArray(children)[0];
  const className = isValidElement<{ className?: string }>(child) ? (child.props.className ?? "") : "";
  const language = /language-([\w+#.-]+)/.exec(className)?.[1];

  return (
    <div className="not-prose my-4 overflow-hidden rounded-xl bg-[#0d0d0d] text-neutral-100">
      <div className="flex items-center justify-between bg-[#1f1f1f] py-1 pl-4 pr-1 text-xs text-neutral-400">
        <span>{language ?? "text"}</span>
        <CopyButton
          label="Copy code"
          getText={() => ref.current?.innerText ?? ""}
          className="text-neutral-400 hover:bg-white/10 hover:text-white"
        />
      </div>
      <pre ref={ref} {...rest} className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed">
        {children}
      </pre>
    </div>
  );
}

const components: Components = {
  pre: CodeBlock,
  a: ({ node, ...props }) => {
    void node;
    return <a {...props} target="_blank" rel="noopener noreferrer" />;
  },
  table: ({ node, ...props }) => {
    void node;
    return (
      <div className="overflow-x-auto">
        <table {...props} />
      </div>
    );
  },
};

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

export const Markdown = memo(function Markdown({ content, streaming = false }: { content: string; streaming?: boolean }) {
  return (
    <div className={cn("markdown prose prose-neutral max-w-none break-words", streaming && "streaming-cursor")}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
