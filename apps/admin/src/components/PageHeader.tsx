import type { ReactNode } from 'react'

export function PageHeader({ eyebrow, title, description, extra }: { eyebrow: string; title: string; description: string; extra?: ReactNode }) {
  return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{extra}</header>
}
