import { Link } from 'react-router'

export function NotFound() {
  return (
    <div>
      <h1>Chart not found</h1>
      <p>
        <Link to="/">Back to all charts</Link>
      </p>
    </div>
  )
}
