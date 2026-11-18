import { House } from 'lucide-react';
import Button from '@/components/ui/Button';
import Logo from '@/components/ui/Logo';
import Shell from '@/components/ui/Shell';
import ThemeToggle from '@/components/ui/ThemeToggle';
import ResultsView from '@/components/results/ResultsView';

export const metadata = {
  title: 'Test results · Anchor',
  description: 'How accurate Anchor is: measured on questions with known answers, with every number explained.',
};

// The measured test results, for visitors and examiners. The numbers are loaded in the
// browser from GET /api/results, so a new saved test run shows up without a rebuild.
export default function ResultsPage() {
  return (
    <div className="p-2 sm:p-3 lg:p-5">
      <Shell className="mx-auto max-w-[1560px] overflow-hidden">
        <header className="flex items-center justify-between gap-4 px-4 py-4 sm:px-8 sm:py-5">
          <Logo />
          <div className="flex items-center gap-1 sm:gap-2">
            <Button href="/" variant="ghost" size="sm" className="max-sm:px-3">
              <House className="size-4" aria-hidden /> <span className="max-sm:sr-only">Home</span>
            </Button>
            <ThemeToggle />
            <Button href="/chat" size="sm">Try Anchor</Button>
          </div>
        </header>
        <main>
          <ResultsView />
        </main>
      </Shell>
    </div>
  );
}
