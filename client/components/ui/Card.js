export default function Card({ as: Tag = 'div', className = '', ...props }) {
  return <Tag className={`rounded-card border border-border bg-surface shadow-soft ${className}`} {...props} />;
}
