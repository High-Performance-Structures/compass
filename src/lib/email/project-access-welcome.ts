export type ProjectAccessWelcomeTemplateInput = {
  readonly recipientName: string
  readonly projectLabel: string
  readonly companyName?: string
}

export type ProjectAccessWelcomeTemplate = {
  readonly subject: string
  readonly message: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

export function projectAccessWelcomeTemplate(
  input: ProjectAccessWelcomeTemplateInput
): ProjectAccessWelcomeTemplate {
  const companyName = input.companyName ?? "High Performance Structures Inc."
  return {
    subject: `Welcome to Compass for ${input.projectLabel}`,
    message: `Hi ${input.recipientName},

We are moving project communication and collaboration from Buildertrend to Compass, our project workspace for ${input.projectLabel}.

What is changing:
- Compass will be the place to view the information shared with you for this project, including updates, messages, schedules, approved photos, documents, and selections as they become available.
- Project notifications will come from Compass, and you can choose your email, text, and in-app notification preferences after signing in.

What is staying the same:
- You will continue working with the same ${companyName} team.
- Existing project records remain part of the project history.
- Private accounting, internal notes, and information outside your approved project access remain restricted.

Use the secure button below to set up or open your Compass account. If you need help, reply to this email and our team will assist you.

Thank you,
${companyName}`,
  }
}

function messageHtml(message: string): string {
  const lines = message.replace(/\r\n/g, "\n").split("\n")
  const parts: string[] = []
  let listItems: string[] = []

  const flushList = (): void => {
    if (listItems.length === 0) return
    parts.push(
      `<ul style="margin:0 0 18px;padding-left:22px;color:#292b27;line-height:1.6">${listItems
        .map((item) => `<li style="margin:0 0 7px">${escapeHtml(item)}</li>`)
        .join("")}</ul>`
    )
    listItems = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.startsWith("- ")) {
      listItems.push(line.slice(2))
      continue
    }

    flushList()
    if (!line) continue
    if (line.endsWith(":")) {
      parts.push(
        `<h2 style="margin:22px 0 8px;font-size:15px;color:#173b2a">${escapeHtml(line)}</h2>`
      )
      continue
    }
    parts.push(
      `<p style="margin:0 0 14px;color:#292b27;line-height:1.6">${escapeHtml(line)}</p>`
    )
  }

  flushList()
  return parts.join("")
}

export function buildProjectAccessWelcomeHtml(input: {
  readonly message: string
  readonly actionUrl: string
  readonly actionLabel: string
  readonly projectLabel: string
}): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f3f4f1;font-family:Arial,Helvetica,sans-serif;color:#292b27">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f1;padding:28px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border:1px solid #d8ddd7">
          <tr><td style="padding:22px 28px;background:#173b2a;color:#ffffff">
            <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Compass</div>
            <div style="margin-top:6px;font-size:22px;font-weight:700">${escapeHtml(input.projectLabel)}</div>
          </td></tr>
          <tr><td style="padding:28px">
            ${messageHtml(input.message)}
            <div style="margin:26px 0 20px">
              <a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;background:#3f7d4d;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:4px">${escapeHtml(input.actionLabel)}</a>
            </div>
            <p style="margin:0;color:#6b706a;font-size:12px;line-height:1.5">This invitation only grants access to projects explicitly assigned to your account.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}
