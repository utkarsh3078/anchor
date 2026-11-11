// The translucent rounded panel every screen sits in, over the page gradient. The landing
// page, the key screen and the chat all use it, which is what makes them read as one site.
export default function Shell({ as: Tag = 'div', className = '', ...props }) {
  return <Tag className={`rounded-shell border border-shell-border bg-shell shadow-shell ${className}`} {...props} />;
}
