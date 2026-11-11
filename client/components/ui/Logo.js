import Link from 'next/link';
import { Anchor } from 'lucide-react';

export default function Logo({ href = '/' }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 rounded-full text-fg">
      <span className="inline-flex size-9 items-center justify-center rounded-full bg-primary text-primary-fg shadow-ink">
        <Anchor className="size-[18px]" strokeWidth={2.4} aria-hidden />
      </span>
      <span className="text-xl font-bold tracking-tight">Anchor</span>
    </Link>
  );
}
