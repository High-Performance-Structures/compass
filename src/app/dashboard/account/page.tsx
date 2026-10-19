import { AccountDeletionSection } from "@/components/account-deletion-section"
import { ContextualHelpBeacon } from "@/components/help/contextual-help-beacon"
import { Separator } from "@/components/ui/separator"

export default function AccountPage(): React.ReactElement {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6 md:px-8">
      <div className="max-w-xl space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
            <ContextualHelpBeacon topicId="support.account-deletion" />
          </div>
          <p className="text-sm text-muted-foreground">
            Manage account privacy and deletion.
          </p>
        </div>
        <Separator />
        <AccountDeletionSection />
      </div>
    </div>
  )
}
