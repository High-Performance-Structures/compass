"use client"

import { CheckIcon, CopyIcon } from "lucide-react"
import {
  type ComponentProps,
  createContext,
  type HTMLAttributes,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import type { BundledLanguage, ShikiTransformer } from "shiki"
import { createHighlighterCore, type HighlighterCore } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string
  language: BundledLanguage
  showLineNumbers?: boolean
}

interface CodeBlockContextType {
  code: string
}

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: "",
})

const lineNumberTransformer: ShikiTransformer = {
  name: "line-numbers",
  line(node, line) {
    node.children.unshift({
      type: "element",
      tagName: "span",
      properties: {
        className: [
          "inline-block",
          "min-w-10",
          "mr-4",
          "text-right",
          "select-none",
          "text-muted-foreground",
        ],
      },
      children: [{ type: "text", value: String(line) }],
    })
  },
}

const SUPPORTED_LANGUAGES = [
  "bash",
  "css",
  "go",
  "html",
  "javascript",
  "json",
  "jsx",
  "markdown",
  "python",
  "rust",
  "sql",
  "tsx",
  "typescript",
  "yaml",
] as const

type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

let highlighterPromise: Promise<HighlighterCore> | null = null

function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise === null) {
    highlighterPromise = createHighlighterCore({
      themes: [
        import("@shikijs/themes/one-light"),
        import("@shikijs/themes/one-dark-pro"),
      ],
      langs: [
        import("@shikijs/langs/bash"),
        import("@shikijs/langs/css"),
        import("@shikijs/langs/go"),
        import("@shikijs/langs/html"),
        import("@shikijs/langs/javascript"),
        import("@shikijs/langs/json"),
        import("@shikijs/langs/jsx"),
        import("@shikijs/langs/markdown"),
        import("@shikijs/langs/python"),
        import("@shikijs/langs/rust"),
        import("@shikijs/langs/sql"),
        import("@shikijs/langs/tsx"),
        import("@shikijs/langs/typescript"),
        import("@shikijs/langs/yaml"),
      ],
      engine: createJavaScriptRegexEngine(),
    })
  }

  return highlighterPromise
}

function supportedLanguage(language: BundledLanguage): SupportedLanguage | null {
  if (language === "sh" || language === "shell" || language === "zsh") return "bash"
  if (language === "js") return "javascript"
  if (language === "md") return "markdown"
  if (language === "py") return "python"
  if (language === "ts") return "typescript"
  if (language === "yml") return "yaml"

  for (const supported of SUPPORTED_LANGUAGES) {
    if (language === supported) return supported
  }

  return null
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function plainCodeHtml(code: string, showLineNumbers: boolean): string {
  const content = showLineNumbers
    ? code
        .split("\n")
        .map(
          (line, index) =>
            `<span class="line"><span class="inline-block min-w-10 mr-4 text-right select-none text-muted-foreground">${index + 1}</span>${escapeHtml(line)}</span>`,
        )
        .join("\n")
    : escapeHtml(code)

  return `<pre class="shiki" style="background-color:transparent;color:inherit"><code>${content}</code></pre>`
}

export async function highlightCode(
  code: string,
  language: BundledLanguage,
  showLineNumbers = false,
) {
  const normalizedLanguage = supportedLanguage(language)
  if (normalizedLanguage === null) {
    const plain = plainCodeHtml(code, showLineNumbers)
    return [plain, plain]
  }

  const transformers: ShikiTransformer[] = showLineNumbers ? [lineNumberTransformer] : []
  const highlighter = await getHighlighter()

  return await Promise.all([
    highlighter.codeToHtml(code, {
      lang: normalizedLanguage,
      theme: "one-light",
      transformers,
    }),
    highlighter.codeToHtml(code, {
      lang: normalizedLanguage,
      theme: "one-dark-pro",
      transformers,
    }),
  ])
}

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const [html, setHtml] = useState<string>("")
  const [darkHtml, setDarkHtml] = useState<string>("")
  const mounted = useRef(false)

  useEffect(() => {
    highlightCode(code, language, showLineNumbers).then(([light, dark]) => {
      if (!mounted.current) {
        setHtml(light)
        setDarkHtml(dark)
        mounted.current = true
      }
    })

    return () => {
      mounted.current = false
    }
  }, [code, language, showLineNumbers])

  return (
    <CodeBlockContext.Provider value={{ code }}>
      <div
        className={cn(
          "group relative w-full overflow-hidden rounded-md border bg-background text-foreground",
          className,
        )}
        {...props}
      >
        <div className="relative">
          <div
            className="overflow-auto dark:hidden [&>pre]:m-0 [&>pre]:bg-background! [&>pre]:p-4 [&>pre]:text-foreground! [&>pre]:text-sm [&_code]:font-mono [&_code]:text-sm"
            dangerouslySetInnerHTML={{ __html: html }}
          />
          <div
            className="hidden overflow-auto dark:block [&>pre]:m-0 [&>pre]:bg-background! [&>pre]:p-4 [&>pre]:text-foreground! [&>pre]:text-sm [&_code]:font-mono [&_code]:text-sm"
            dangerouslySetInnerHTML={{ __html: darkHtml }}
          />
          {children && (
            <div className="absolute top-2 right-2 flex items-center gap-2">{children}</div>
          )}
        </div>
      </div>
    </CodeBlockContext.Provider>
  )
}

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  onCopy?: () => void
  onError?: (error: Error) => void
  timeout?: number
}

export const CodeBlockCopyButton = ({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false)
  const { code } = useContext(CodeBlockContext)

  const copyToClipboard = async () => {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      onError?.(new Error("Clipboard API not available"))
      return
    }

    try {
      await navigator.clipboard.writeText(code)
      setIsCopied(true)
      onCopy?.()
      setTimeout(() => setIsCopied(false), timeout)
    } catch (error) {
      onError?.(error as Error)
    }
  }

  const Icon = isCopied ? CheckIcon : CopyIcon

  return (
    <Button
      className={cn("shrink-0", className)}
      onClick={copyToClipboard}
      size="icon"
      variant="ghost"
      {...props}
    >
      {children ?? <Icon size={14} />}
    </Button>
  )
}

/** Demo component for preview */
export default function CodeBlockDemo() {
  const code = `function MyComponent(props) {
  return (
    <div>
      <h1>Hello, {props.name}!</h1>
      <p>This is an example React component.</p>
    </div>
  );
}`

  return (
    <div className="w-full max-w-2xl p-6">
      <CodeBlock code={code} language="jsx">
        <CodeBlockCopyButton
          onCopy={() => console.log("Copied code to clipboard")}
          onError={() => console.error("Failed to copy code to clipboard")}
        />
      </CodeBlock>
    </div>
  )
}
