import { cn } from "@/lib/utils"

interface PromptSuggestionsProps {
  label: string
  append: (message: { role: "user"; content: string }) => void
  suggestions: string[]
}

export function PromptSuggestions({
  label,
  append,
  suggestions,
}: PromptSuggestionsProps) {
  return (
    <div className="flex flex-1 flex-col justify-end gap-3 px-4 pb-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-col gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() =>
              append({ role: "user", content: suggestion })
            }
            className={cn(
              "rounded-lg border px-3 py-2.5 text-left text-sm",
              "text-foreground",
              "transition-colors hover:bg-muted",
              "focus-visible:border-ring focus-visible:ring-ring/50",
              "focus-visible:outline-none focus-visible:ring-[3px]"
            )}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  )
}
