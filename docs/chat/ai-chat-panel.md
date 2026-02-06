AI Chat Panel
===

status: disabled
branch: `feat/ai-chat-panel`

overview
---

a collapsible right-side chat panel that mirrors the left sidebar's behavior. uses prompt-kit components (shadcn-compatible AI primitives) for the chat UI. styled to match the sidebar's color scheme (bg-sidebar, text-sidebar-foreground). currently uses mock responses - structured for a real AI backend later.

enabling the feature
---

to re-enable, update `src/app/dashboard/layout.tsx`:

```tsx
import { cookies } from "next/headers"
import { ChatPanel } from "@/components/chat-panel"
import { ChatPanelTrigger } from "@/components/chat-panel-trigger"
import { ChatPanelProvider } from "@/hooks/use-chat-panel"

// inside the component:
const cookieStore = await cookies()
const chatPanelOpen = cookieStore.get("chat_panel_state")?.value === "true"

// wrap SidebarProvider contents with:
<ChatPanelProvider defaultOpen={chatPanelOpen}>
  {/* existing sidebar + content */}
  <ChatPanel />
  <ChatPanelTrigger />
</ChatPanelProvider>
```

file structure
---

```
src/
├── components/
│   ├── ui/
│   │   ├── chat-container.tsx     (prompt-kit: auto-scrolling message area)
│   │   ├── message.tsx            (prompt-kit: message with avatar + content)
│   │   ├── prompt-input.tsx       (prompt-kit: auto-resize textarea + actions)
│   │   ├── prompt-suggestion.tsx  (prompt-kit: button-style suggestion pills)
│   │   ├── markdown.tsx           (prompt-kit dep: markdown rendering)
│   │   └── code-block.tsx         (prompt-kit dep: syntax highlighted code)
│   ├── chat-panel.tsx             (panel shell - gap div + fixed container)
│   ├── chat-panel-trigger.tsx     (floating FAB button, bottom-right)
│   └── chat-panel-content.tsx     (messages + input + suggestions inner UI)
├── hooks/
│   └── use-chat-panel.tsx         (context provider, cookie persistence, Ctrl+I)
└── lib/
    └── chat-suggestions.ts        (route-based suggestion configs)
```

components used
---

**prompt-kit** (installed via shadcn registry: `https://prompt-kit.com/c/[name].json`)

- `ChatContainerRoot` / `ChatContainerContent` / `ChatContainerScrollAnchor` - wraps `use-stick-to-bottom` for auto-scroll behavior
- `Message` / `MessageAvatar` / `MessageContent` - composable message layout with avatar support
- `PromptInput` / `PromptInputTextarea` / `PromptInputActions` / `PromptInputAction` - compound input component with auto-resize, enter-to-submit, tooltip actions
- `PromptSuggestion` - button-based suggestions with highlight support

**dependencies added:**

- `use-stick-to-bottom` - handles the auto-scroll-to-bottom behavior in the chat container

how it works
---

**panel architecture:**

mirrors the left sidebar's pattern exactly:
1. a "gap" div in the flex flow that transitions width (0 <-> 24rem) to push content
2. a fixed container that transitions its `right` position to slide in/out
3. inner div uses `bg-sidebar` to match the sidebar's color

**state management:**

- `ChatPanelProvider` wraps everything, provides open/close state
- cookie persistence via `chat_panel_state` cookie (7-day max-age)
- keyboard shortcut: `Cmd/Ctrl+I` (doesn't conflict with sidebar's `Cmd+B`)
- mobile: renders as a Sheet from the right side

**styling approach:**

uses sidebar CSS variables throughout to maintain visual consistency:
- `bg-sidebar` / `text-sidebar-foreground` for panel background
- `bg-sidebar-accent` / `text-sidebar-accent-foreground` for user messages
- `bg-sidebar-foreground/10` for assistant messages
- `border-sidebar-foreground/20` for borders/input
- `bg-sidebar-primary` for the send button

**mock responses:**

currently uses a random canned response with a simulated delay (800-1500ms). the message handling is structured to be easily swapped for a real streaming backend.

what's left to do
---

1. **real AI backend** - replace the mock `setTimeout` in `chat-panel-content.tsx` with actual API calls (vercel AI SDK `useChat` would slot in nicely here)

2. **streaming responses** - the `MessageContent` component supports markdown rendering (`markdown` prop). when streaming is added, use it for formatted AI responses

3. **token usage** - the prompt-kit components support more features than currently used:
   - `MessageActions` / `MessageAction` for copy/thumbs-up/thumbs-down on messages
   - `PromptSuggestion` highlight mode for autocomplete-style suggestions
   - multiple file attachment via the prompt input actions area

4. **context awareness** - the suggestion system (`chat-suggestions.ts`) currently just matches pathname prefix. could be enhanced to include:
   - current project data in the prompt
   - file contents when on the files route
   - schedule data when on the schedule route

5. **message persistence** - messages are currently in React state (lost on navigation). could persist to localStorage or a server-side store

6. **panel width** - currently hardcoded to 24rem. could be made resizable with `react-resizable-panels` (already in deps)

7. **animation polish** - the panel slide animation works but could benefit from the same `data-state` attribute pattern the sidebar uses for more granular CSS control
