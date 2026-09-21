// The branded preview shares the original service, authentication and project storage.
// Keep the request URL intact so Clerk verifies the actual frontend origin.
export default {
  fetch(request: Request, env: { MODELER: Fetcher }): Promise<Response> {
    return env.MODELER.fetch(request)
  },
} satisfies ExportedHandler<{ MODELER: Fetcher }>
