// Help video: Navigating Projects → Open a Project (topic projects.navigation.open-project).
import { BASE_URL } from "../lib.mjs"

export const clip = {
  id: "projects-open-project",
  topicId: "projects.navigation.open-project",
  title: "Find and open a project",
}

export async function record({ page, open, caption, click, pause }) {
  await open(`${BASE_URL}/dashboard`)
  await caption("Open Projects in the sidebar, then All Projects.", 1200)
  const sidebar = page.locator('[data-slot="sidebar-inner"]')
  const allProjects = sidebar.getByRole("link", { name: "All Projects" })
  if (!(await allProjects.isVisible())) await click(sidebar.getByRole("button", { name: "Projects", exact: true }))
  await click(allProjects)
  await page.getByRole("heading", { name: "Project Hub" }).waitFor()

  await caption("Choose a department and status view to narrow the list.", 1200)
  await click(page.getByRole("button", { name: /^HPS \d+$/ }))
  await pause(600)

  await caption("Search by project number, client, name, or address.", 1000)
  await click(page.getByText("Jump to project"))
  await page.keyboard.type("H-DEV", { delay: 90 })
  await pause(1200)
  await caption("Pick the project to open its overview.", 1000)
  await click(page.getByRole("option", { name: /Compass Developer/ }).first())
  await page.waitForURL(/\/dashboard\/projects\/compass-developer/)
  await page.waitForLoadState("networkidle")
  await pause(1000)
  await caption("You only see the tools your role and assignment allow.", 2800)
}
