// Render de markdown (títulos, negritas, listas, tablas) para las respuestas de IA.
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './Markdown.module.css'

export default function Markdown({ children, className }) {
  return (
    <div className={`${styles.md} ${className || ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children || ''}</ReactMarkdown>
    </div>
  )
}
