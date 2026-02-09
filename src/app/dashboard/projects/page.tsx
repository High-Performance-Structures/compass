export const dynamic = "force-dynamic"

import { getDb } from "@/lib/db-universal"
import { projects } from "@/db/schema"
import { desc } from "drizzle-orm"
import { IconFolder, IconPlus } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { CreateProjectDialog } from "@/components/projects/create-project-dialog"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import Link from "next/link"

export default async function ProjectsPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let allProjects: any[] = []

  try {
    const db = await getDb()
    allProjects = await db
      .select()
      .from(projects)
      .orderBy(desc(projects.createdAt))
  } catch (e) {
    console.error("Failed to fetch projects", e)
  }

  if (allProjects.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-center text-muted-foreground">
        <div className="flex flex-col items-center gap-4">
          <IconFolder className="mx-auto size-12 opacity-50" />
          <p>No projects yet.</p>
          <CreateProjectDialog>
            <Button>
              <IconPlus className="mr-2 h-4 w-4" />
              Create Project
            </Button>
          </CreateProjectDialog>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
        <CreateProjectDialog>
          <Button>
            <IconPlus className="mr-2 h-4 w-4" />
            Create Project
          </Button>
        </CreateProjectDialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {allProjects.map((project) => (
          <Link href={`/dashboard/projects/${project.id}`} key={project.id}>
            <Card className="h-full hover:bg-muted/50 transition-colors cursor-pointer">
              <CardHeader>
                <CardTitle className="truncate">{project.name}</CardTitle>
                <CardDescription>{project.clientName}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {project.status}
                </p>
              </CardContent>
              <CardFooter className="text-xs text-muted-foreground flex justify-between">
                <span>{project.status}</span>
                <span>Created {new Date(project.createdAt).toLocaleDateString()}</span>
              </CardFooter>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
