'use client'

import { Check, Loader2 } from 'lucide-react'
import { useMarketingAction } from './use-marketing-action'

/** Markedsføringsoppgavene. Noen hukes av automatisk når filen de gjelder lages. */
export function ChecklistCard({
  showId,
  tasks,
  action,
}: {
  showId: string
  tasks: Array<{ id: string; label: string; isCompleted: boolean }>
  action: (formData: FormData) => Promise<void>
}) {
  const { run, isRunning, isPending } = useMarketingAction()
  const done = tasks.filter((task) => task.isCompleted).length

  if (tasks.length === 0) return null

  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Checklist</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{done}/{tasks.length}</span>
      </header>

      <ul className="divide-y">
        {tasks.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              disabled={isPending}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40 disabled:opacity-70"
              onClick={() => {
                const formData = new FormData()
                formData.set('show_id', showId)
                formData.set('task_id', task.id)
                formData.set('is_completed', String(task.isCompleted))
                run(task.id, () => action(formData))
              }}
            >
              <span
                className={`grid size-5 shrink-0 place-content-center rounded border-2 transition-colors ${
                  task.isCompleted ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                }`}
              >
                {isRunning(task.id)
                  ? <Loader2 className="size-3 animate-spin" aria-hidden />
                  : task.isCompleted ? <Check className="size-3" aria-hidden /> : null}
              </span>
              <span className={`text-sm ${task.isCompleted ? 'text-muted-foreground line-through' : ''}`}>
                {task.label}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
