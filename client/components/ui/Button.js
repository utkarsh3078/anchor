import Link from 'next/link';

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap ' +
  'transition-[background-color,color,border-color,box-shadow,transform] duration-200 ease-out ' +
  'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50';

const variants = {
  primary: 'bg-primary text-primary-fg shadow-ink hover:bg-primary-hover',
  // For use on a bg-primary band
  inverse: 'bg-primary-fg text-primary hover:opacity-90',
  secondary: 'border border-border-strong bg-surface text-fg hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-fg',
  link: 'text-accent underline-offset-4 hover:underline',
};

const sizes = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-11 px-5 text-sm',
  lg: 'h-12 px-7 text-base',
};

export const buttonClass = ({ variant = 'primary', size = 'md', className = '' } = {}) =>
  `${base} ${variants[variant]} ${variant === 'link' ? '' : sizes[size]} ${className}`;

// A <button>, or a Next <Link> styled as one when href is given
export default function Button({ href, variant, size, className, type = 'button', ...props }) {
  const cls = buttonClass({ variant, size, className });
  if (href) return <Link href={href} className={cls} {...props} />;
  return <button type={type} className={cls} {...props} />;
}
