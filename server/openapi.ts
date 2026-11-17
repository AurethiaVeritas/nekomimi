const errorResponse = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorResponse' },
    },
  },
};

const unauthorizedResponse = {
  description: 'Authentication is required',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorResponse' },
      examples: {
        unauthorized: { value: { error: 'Unauthorized' } },
      },
    },
  },
};

const workFilters = [
  { $ref: '#/components/parameters/Query' },
  { $ref: '#/components/parameters/NsfwFilter' },
  { $ref: '#/components/parameters/AgeRatingFilter' },
  { $ref: '#/components/parameters/CircleFilter' },
  { $ref: '#/components/parameters/TagFilter' },
  { $ref: '#/components/parameters/VaFilter' },
];

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Nekomimi HTTP API',
    version: '0.1.0',
    description: 'OpenAPI contract for the Nekomimi ASMR media server.',
  },
  servers: [
    {
      url: '/',
      description: 'Current server',
    },
  ],
  tags: [
    { name: 'Auth', description: 'Cookie-based authentication' },
    { name: 'Health' },
    { name: 'Settings' },
    { name: 'Logs' },
    { name: 'Works' },
    { name: 'Collections', description: 'User-owned manual collections and smart collections driven by tags and content rating' },
    { name: 'Import' },
    { name: 'Covers' },
    { name: 'Files' },
    { name: 'Scanning' },
  ],
  paths: {
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        security: [],
        responses: {
          '200': {
            description: 'Server is healthy',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OkResponse' },
              },
            },
          },
        },
      },
    },
    '/api/auth/setup-token': {
      post: {
        tags: ['Auth'],
        summary: 'Verify the startup token before account setup',
        description: 'Does not create a session or consume the token. Bootstrap must still supply the token, which becomes invalid on server restart.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['setupToken'], properties: { setupToken: { type: 'string' } } },
            },
          },
        },
        responses: {
          '200': { description: 'Token verified', content: { 'application/json': { schema: { $ref: '#/components/schemas/OkResponse' } } } },
          '400': errorResponse,
          '403': errorResponse,
          '429': errorResponse,
        },
      },
    },
    '/api/auth/bootstrap': {
      post: {
        tags: ['Auth'],
        summary: 'Initialize the first admin user',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/AuthCredentials' },
                  { type: 'object', required: ['setupToken'], properties: {
                    setupToken: { type: 'string', description: 'Account setup token printed in the server terminal at startup. Changes on restart until initialized.' },
                  } },
                ],
              },
            },
          },
        },
        responses: {
          '200': { $ref: '#/components/responses/AuthUserResponse' },
          '400': errorResponse,
          '403': errorResponse,
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in and set the auth cookie',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AuthCredentials' },
            },
          },
        },
        responses: {
          '200': { $ref: '#/components/responses/AuthUserResponse' },
          '400': errorResponse,
          '401': errorResponse,
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Log out, clear the auth cookie, and revoke all account sessions',
        security: [],
        responses: {
          '200': {
            description: 'Logged out',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OkResponse' },
              },
            },
          },
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get the current authenticated user',
        security: [],
        responses: {
          '200': { $ref: '#/components/responses/AuthUserResponse' },
          '401': {
            description: 'No authenticated user',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { user: { type: 'null' } },
                  required: ['user'],
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/change-password': {
      post: {
        tags: ['Auth'],
        summary: 'Change the password and revoke earlier account sessions',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ChangePasswordRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Password changed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OkResponse' },
              },
            },
          },
          '400': errorResponse,
          '401': errorResponse,
        },
      },
    },
    '/api/settings': {
      get: {
        tags: ['Settings'],
        summary: 'Get server settings',
        security: [{ cookieAuth: [] }],
        responses: {
          '200': {
            description: 'Current settings',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Settings' },
              },
            },
          },
          '401': unauthorizedResponse,
        },
      },
      put: {
        tags: ['Settings'],
        summary: 'Update server settings',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SettingsUpdate' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated settings',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Settings' },
              },
            },
          },
          '400': errorResponse,
          '401': unauthorizedResponse,
          '500': errorResponse,
        },
      },
    },
    '/api/settings/proxy-check': {
      post: {
        tags: ['Settings'],
        summary: 'Check scraper proxy connectivity',
        description: 'Requests ipconfig.org and DLsite through the configured scraper proxy path.',
        security: [{ cookieAuth: [] }],
        responses: {
          '200': {
            description: 'Connectivity check result',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ProxyCheckResult' },
              },
            },
          },
          '401': unauthorizedResponse,
        },
      },
    },
    '/api/logs': {
      get: {
        tags: ['Logs'],
        summary: 'List recent server logs',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/LogLimit' }],
        responses: {
          '200': {
            description: 'Recent log entries',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    logs: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/LogEntry' },
                    },
                  },
                  required: ['logs'],
                },
              },
            },
          },
          '401': unauthorizedResponse,
        },
      },
    },
    '/api/logs/stream': {
      get: {
        tags: ['Logs'],
        summary: 'Stream server logs as Server-Sent Events',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/History' }],
        responses: {
          '200': {
            description: 'SSE stream of log entries',
            content: {
              'text/event-stream': {
                schema: { type: 'string' },
              },
            },
          },
          '401': unauthorizedResponse,
        },
      },
    },
    '/api/works': {
      get: {
        tags: ['Works'],
        summary: 'List works',
        description: 'Returns a paginated list of works.',
        security: [{ cookieAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/Page' },
          { $ref: '#/components/parameters/PageSize' },
          { $ref: '#/components/parameters/WorkSort' },
          ...workFilters,
        ],
        responses: {
          '200': {
            description: 'Paginated work result',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaginatedWorks' },
              },
            },
          },
          '401': unauthorizedResponse,
          '500': errorResponse,
        },
      },
    },
    '/api/works/facets': {
      get: {
        tags: ['Works'],
        summary: 'List work filter facets',
        security: [{ cookieAuth: [] }],
        parameters: workFilters,
        responses: {
          '200': {
            description: 'Facet counts',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Facets' },
              },
            },
          },
          '401': unauthorizedResponse,
          '500': errorResponse,
        },
      },
    },
    '/api/collections': {
      get: {
        tags: ['Collections'],
        summary: 'List collections owned by the current user',
        description: 'When workId is supplied, every collection also reports whether it currently contains that work. Smart collection membership is evaluated from the work tags and content filter.',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/CollectionWorkQuery' }],
        responses: {
          '200': {
            description: 'Current user collections, ordered by most recently updated',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Collection' },
                },
              },
            },
          },
          '401': unauthorizedResponse,
          '500': errorResponse,
        },
      },
      post: {
        tags: ['Collections'],
        summary: 'Create a collection',
        description: 'Collection names are unique per user, ignoring case. Smart collections require at least one tag and include all age ratings by default.',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CollectionCreate' },
              examples: {
                manual: { value: { name: 'Favorites', type: 'manual' } },
                smart: {
                  value: {
                    name: 'Sleep & Relax',
                    type: 'smart',
                    match: 'and',
                    ageRatings: ['sfw', 'r15'],
                    tags: ['Whispering', 'Sleep', 'Relaxing'],
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created collection',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Collection' },
              },
            },
          },
          '400': errorResponse,
          '401': unauthorizedResponse,
          '409': errorResponse,
          '500': errorResponse,
        },
      },
    },
    '/api/collections/{id}': {
      get: {
        tags: ['Collections'],
        summary: 'Get a collection',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/CollectionId' }],
        responses: {
          '200': {
            description: 'Collection details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Collection' },
              },
            },
          },
          '401': unauthorizedResponse,
          '404': errorResponse,
          '500': errorResponse,
        },
      },
      put: {
        tags: ['Collections'],
        summary: 'Update a collection',
        description: 'Omitted fields retain their current values. Changing a collection to smart removes any stored manual memberships.',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/CollectionId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CollectionUpdate' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated collection',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Collection' },
              },
            },
          },
          '400': errorResponse,
          '401': unauthorizedResponse,
          '404': errorResponse,
          '409': errorResponse,
          '500': errorResponse,
        },
      },
      delete: {
        tags: ['Collections'],
        summary: 'Delete a collection',
        description: 'Deletes the collection and its stored manual memberships. Work records are not deleted.',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/CollectionId' }],
        responses: {
          '200': {
            description: 'Collection deleted',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OkResponse' },
              },
            },
          },
          '401': unauthorizedResponse,
          '404': errorResponse,
          '500': errorResponse,
        },
      },
    },
    '/api/collections/{id}/works': {
      get: {
        tags: ['Collections'],
        summary: 'List works in a collection',
        description: 'Manual collections use stored memberships. Smart collections are evaluated from current work tags and content filter on every request.',
        security: [{ cookieAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/CollectionId' },
          { $ref: '#/components/parameters/Page' },
          { $ref: '#/components/parameters/PageSize' },
          { $ref: '#/components/parameters/WorkSort' },
        ],
        responses: {
          '200': {
            description: 'Paginated collection works',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaginatedWorks' },
              },
            },
          },
          '401': unauthorizedResponse,
          '404': errorResponse,
          '500': errorResponse,
        },
      },
    },
    '/api/collections/{id}/works/{workId}': {
      put: {
        tags: ['Collections'],
        summary: 'Set manual collection membership for a work',
        description: 'Adds or removes a work from a manual collection. Smart collection membership cannot be changed directly.',
        security: [{ cookieAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/CollectionId' },
          { $ref: '#/components/parameters/CollectionWorkId' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CollectionMembershipUpdate' },
              examples: {
                add: { value: { included: true } },
                remove: { value: { included: false } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated collection with containsWork reflecting the requested membership',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Collection' },
              },
            },
          },
          '400': errorResponse,
          '401': unauthorizedResponse,
          '404': errorResponse,
          '500': errorResponse,
        },
      },
    },
    '/api/circles': {
      get: {
        tags: ['Works'],
        summary: 'List circle summaries',
        security: [{ cookieAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/NsfwFilter' },
          { $ref: '#/components/parameters/AgeRatingFilter' },
          { $ref: '#/components/parameters/CircleSort' },
        ],
        responses: {
          '200': {
            description: 'Circle summaries',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/CircleSummary' },
                },
              },
            },
          },
          '401': unauthorizedResponse,
          '500': errorResponse,
        },
      },
    },
    '/api/works/{id}': {
      get: {
        tags: ['Works'],
        summary: 'Get work details',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/WorkId' }],
        responses: {
          '200': {
            description: 'Work details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Work' },
              },
            },
          },
          '401': unauthorizedResponse,
          '404': errorResponse,
        },
      },
      put: {
        tags: ['Works'],
        summary: 'Update work metadata',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/WorkId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/WorkUpdate' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated work',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Work' },
              },
            },
          },
          '400': errorResponse,
          '401': unauthorizedResponse,
          '404': errorResponse,
          '500': errorResponse,
        },
      },
      delete: {
        tags: ['Works'],
        summary: 'Delete a work record',
        description: 'Deletes the database record only. Media files on disk are not removed.',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/WorkId' }],
        responses: {
          '200': {
            description: 'Work deleted',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OkResponse' },
              },
            },
          },
          '401': unauthorizedResponse,
          '404': errorResponse,
          '500': errorResponse,
        },
      },
    },
    '/api/works/{id}/media': {
      post: {
        tags: ['Works'],
        summary: 'Attach media files to a work',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/WorkId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AttachMediaRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated work',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Work' },
              },
            },
          },
          '400': errorResponse,
          '401': unauthorizedResponse,
          '404': errorResponse,
        },
      },
    },
    '/api/works/{id}/align': {
      post: {
        tags: ['Works'],
        summary: 'Align a work to configured scan paths',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/WorkId' }],
        responses: {
          '200': {
            description: 'Aligned work or unchanged status',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/Work' },
                    {
                      type: 'object',
                      properties: {
                        aligned: { type: 'boolean' },
                        message: { type: 'string' },
                        repairRequired: { type: 'boolean' },
                        issueCode: { type: 'string', enum: ['SMB_FILENAME_UNREACHABLE'] },
                        currentPath: { type: ['string', 'null'] },
                        inaccessiblePath: { type: 'string' },
                        suggestedPath: { type: 'string' },
                        coverRestored: { type: 'boolean' },
                      },
                    },
                  ],
                },
              },
            },
          },
          '400': errorResponse,
          '401': unauthorizedResponse,
          '404': errorResponse,
          '500': errorResponse,
        },
      },
    },
    '/api/import/dlsite': {
      post: {
        tags: ['Import'],
        summary: 'Import or update a work from DLsite metadata',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/DlsiteImportRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Created or updated work',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Work' },
              },
            },
          },
          '400': errorResponse,
          '401': unauthorizedResponse,
          '500': errorResponse,
        },
      },
    },
    '/cover/{id}': {
      get: {
        tags: ['Covers'],
        summary: 'Stream a work cover image',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/WorkId' }],
        responses: {
          '200': {
            description: 'Cover image',
            headers: {
              ETag: { schema: { type: 'string' } },
              'Cache-Control': { schema: { type: 'string' } },
            },
            content: {
              'image/jpeg': { schema: { type: 'string', format: 'binary' } },
              'image/png': { schema: { type: 'string', format: 'binary' } },
              'image/webp': { schema: { type: 'string', format: 'binary' } },
              'image/svg+xml': { schema: { type: 'string', format: 'binary' } },
            },
          },
          '304': { description: 'Cover not modified' },
          '401': unauthorizedResponse,
          '403': errorResponse,
          '404': { description: 'Cover not found' },
        },
      },
    },
    '/api/cover/temp': {
      post: {
        tags: ['Covers'],
        summary: 'Upload a validated, size-limited temporary cover image',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/Filename' }],
        requestBody: {
          required: true,
          content: {
            'image/jpeg': { schema: { type: 'string', format: 'binary' } },
            'image/png': { schema: { type: 'string', format: 'binary' } },
            'image/webp': { schema: { type: 'string', format: 'binary' } },
          },
        },
        responses: {
          '200': {
            description: 'Temporary cover path',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PathResponse' },
              },
            },
          },
          '400': errorResponse,
          '401': unauthorizedResponse,
          '413': errorResponse,
          '500': errorResponse,
        },
      },
    },
    '/api/works/{id}/cover': {
      post: {
        tags: ['Covers'],
        summary: 'Validate, atomically replace, and assign a work cover image',
        security: [{ cookieAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/WorkId' },
          { $ref: '#/components/parameters/Filename' },
        ],
        requestBody: {
          required: true,
          content: {
            'image/jpeg': { schema: { type: 'string', format: 'binary' } },
            'image/png': { schema: { type: 'string', format: 'binary' } },
            'image/webp': { schema: { type: 'string', format: 'binary' } },
          },
        },
        responses: {
          '200': {
            description: 'Updated work',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Work' },
              },
            },
          },
          '400': errorResponse,
          '401': unauthorizedResponse,
          '404': errorResponse,
          '413': errorResponse,
          '500': errorResponse,
        },
      },
    },
    '/api/works/{id}/files': {
      get: {
        tags: ['Files'],
        summary: 'List files under a work base directory',
        security: [{ cookieAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/WorkId' },
          { $ref: '#/components/parameters/FilePathQuery' },
        ],
        responses: {
          '200': {
            description: 'Directory listing',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/FileListing' },
              },
            },
          },
          '400': errorResponse,
          '401': unauthorizedResponse,
          '403': errorResponse,
          '404': errorResponse,
          '409': {
            description: 'The mounted-storage entry is visible but cannot be opened by the host filesystem',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    errorResponse.content['application/json'].schema,
                    {
                      type: 'object',
                      properties: {
                        code: { type: 'string', enum: ['SMB_FILENAME_UNREACHABLE'] },
                        currentPath: { type: 'string' },
                        inaccessiblePath: { type: 'string' },
                        suggestedPath: { type: 'string' },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
    '/files/{id}/{filePath}': {
      get: {
        tags: ['Files'],
        summary: 'Stream a file under a work base directory',
        security: [{ cookieAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/WorkId' },
          {
            name: 'filePath',
            in: 'path',
            required: true,
            description: 'Relative path under the work base directory. May include nested path segments.',
            schema: { type: 'string' },
          },
          { $ref: '#/components/parameters/Range' },
        ],
        responses: {
          '200': { $ref: '#/components/responses/BinaryFile' },
          '206': { $ref: '#/components/responses/PartialBinaryFile' },
          '401': unauthorizedResponse,
          '403': errorResponse,
          '404': { description: 'File not found' },
          '416': { description: 'Invalid or unsatisfiable byte range' },
        },
      },
    },
    '/media/{id}/{filename}': {
      get: {
        tags: ['Files'],
        summary: 'Stream a work media file',
        security: [{ cookieAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/WorkId' },
          {
            name: 'filename',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          { $ref: '#/components/parameters/Range' },
        ],
        responses: {
          '200': { $ref: '#/components/responses/BinaryFile' },
          '206': { $ref: '#/components/responses/PartialBinaryFile' },
          '400': errorResponse,
          '401': unauthorizedResponse,
          '403': errorResponse,
          '404': { description: 'Media not found' },
          '416': { description: 'Invalid or unsatisfiable byte range' },
        },
      },
    },
    '/api/scan': {
      post: {
        tags: ['Scanning'],
        summary: 'Run a scan synchronously',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ScanRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Scan result or dry-run result',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/ScanResult' },
                    { $ref: '#/components/schemas/ScanDryRunResult' },
                  ],
                },
              },
            },
          },
          '400': errorResponse,
          '401': unauthorizedResponse,
          '500': errorResponse,
        },
      },
    },
    '/api/scan/start': {
      post: {
        tags: ['Scanning'],
        summary: 'Start a scan job and return its id',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/ScanQueryPath' }],
        responses: {
          '200': {
            description: 'Started or existing scan job',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ScanJobStatus' },
              },
            },
          },
          '400': errorResponse,
          '401': unauthorizedResponse,
        },
      },
    },
    '/api/scan/active': {
      get: {
        tags: ['Scanning'],
        summary: 'Get the active scan job',
        security: [{ cookieAuth: [] }],
        responses: {
          '200': {
            description: 'Active scan job status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ScanJobStatus' },
              },
            },
          },
          '401': unauthorizedResponse,
        },
      },
    },
    '/api/scan/stream': {
      get: {
        tags: ['Scanning'],
        summary: 'Start or attach to a scan stream',
        security: [{ cookieAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/ScanQueryPath' },
          { $ref: '#/components/parameters/ScanLanguage' },
          { $ref: '#/components/parameters/DryRun' },
          { $ref: '#/components/parameters/NewOnly' },
          { $ref: '#/components/parameters/MetadataOnly' },
        ],
        responses: {
          '200': {
            description: 'SSE scan event stream',
            content: {
              'text/event-stream': {
                schema: { type: 'string' },
              },
            },
          },
          '401': unauthorizedResponse,
        },
      },
    },
    '/api/scan/jobs/{id}/stream': {
      get: {
        tags: ['Scanning'],
        summary: 'Stream an existing scan job',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/ScanJobId' }],
        responses: {
          '200': {
            description: 'SSE scan event stream',
            content: {
              'text/event-stream': {
                schema: { type: 'string' },
              },
            },
          },
          '401': unauthorizedResponse,
          '404': { description: 'Scan job not found' },
        },
      },
    },
    '/api/scan/alignment': {
      get: {
        tags: ['Scanning'],
        summary: 'Run an alignment scan as Server-Sent Events',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/ScanLanguage' }],
        responses: {
          '200': {
            description: 'SSE alignment event stream',
            content: {
              'text/event-stream': {
                schema: { type: 'string' },
              },
            },
          },
          '401': unauthorizedResponse,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'auth',
      },
    },
    parameters: {
      WorkId: {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Work id or RJ code.',
      },
      CollectionId: {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'integer', minimum: 1 },
        description: 'Collection id. Collections are visible only to their owner.',
      },
      CollectionWorkId: {
        name: 'workId',
        in: 'path',
        required: true,
        schema: { type: 'integer', minimum: 1 },
        description: 'Database id of the work whose manual membership is being changed.',
      },
      CollectionWorkQuery: {
        name: 'workId',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1 },
        description: 'When supplied, includes containsWork on each collection.',
      },
      ScanJobId: {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
      Page: {
        name: 'page',
        in: 'query',
        schema: { type: 'integer', minimum: 1, default: 1 },
      },
      PageSize: {
        name: 'pageSize',
        in: 'query',
        schema: { type: 'integer', minimum: 1, maximum: 200, default: 24 },
      },
      Query: {
        name: 'q',
        in: 'query',
        schema: { type: 'string' },
      },
      NsfwFilter: {
        name: 'nsfw',
        in: 'query',
        description: 'Legacy single age rating filter; ignored when ageRating is provided. nsfw is an alias for r18.',
        schema: { type: 'string', enum: ['all', 'sfw', 'r15', 'r18', 'nsfw'], default: 'all' },
      },
      AgeRatingFilter: {
        name: 'ageRating',
        in: 'query',
        description: 'Repeat for any combination of SFW, R-15, and R-18. Use ageRating=none for no ratings. Overrides nsfw.',
        schema: { type: 'array', items: { type: 'string', enum: ['sfw', 'r15', 'r18', 'none'] } },
        style: 'form',
        explode: true,
      },
      WorkSort: {
        name: 'sort',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['release_desc', 'release_asc', 'title_asc', 'title_desc', 'updated_desc'],
          default: 'updated_desc',
        },
      },
      CircleSort: {
        name: 'sort',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['name_asc', 'name_desc', 'count_desc', 'count_asc'],
          default: 'name_asc',
        },
      },
      CircleFilter: {
        name: 'circle',
        in: 'query',
        schema: { type: 'array', items: { type: 'string' } },
        style: 'form',
        explode: true,
      },
      TagFilter: {
        name: 'tag',
        in: 'query',
        schema: { type: 'array', items: { type: 'string' } },
        style: 'form',
        explode: true,
      },
      VaFilter: {
        name: 'va',
        in: 'query',
        schema: { type: 'array', items: { type: 'string' } },
        style: 'form',
        explode: true,
      },
      LogLimit: {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
      },
      History: {
        name: 'history',
        in: 'query',
        schema: { type: 'boolean', default: true },
      },
      Filename: {
        name: 'filename',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: 'Original filename with .jpg, .jpeg, .png, or .webp extension.',
      },
      FilePathQuery: {
        name: 'p',
        in: 'query',
        schema: { type: 'string', default: '' },
        description: 'Relative subdirectory path under the work base directory.',
      },
      Range: {
        name: 'Range',
        in: 'header',
        schema: { type: 'string', example: 'bytes=0-1023' },
      },
      ScanQueryPath: {
        name: 'path',
        in: 'query',
        schema: { type: 'array', items: { type: 'string' } },
        style: 'form',
        explode: true,
        description: 'Scan path. Repeat for multiple paths. Defaults to configured scan paths.',
      },
      ScanLanguage: {
        name: 'language',
        in: 'query',
        schema: { type: 'string', default: 'ja-jp', enum: ['ja-jp', 'zh-tw', 'zh-cn'] },
      },
      DryRun: {
        name: 'dryRun',
        in: 'query',
        schema: { type: 'boolean', default: false },
      },
      NewOnly: {
        name: 'newOnly',
        in: 'query',
        schema: { type: 'boolean', default: true },
      },
      MetadataOnly: {
        name: 'metadataOnly',
        in: 'query',
        schema: { type: 'boolean', default: false },
      },
    },
    responses: {
      AuthUserResponse: {
        description: 'Authenticated user response',
        headers: {
          'Set-Cookie': {
            schema: { type: 'string' },
            description: 'JWT auth cookie may be set by login/bootstrap.',
          },
        },
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                user: { $ref: '#/components/schemas/AuthUser' },
              },
              required: ['user'],
            },
          },
        },
      },
      BinaryFile: {
        description: 'Binary file stream',
        headers: {
          'Accept-Ranges': { schema: { type: 'string', example: 'bytes' } },
          'Content-Length': { schema: { type: 'integer' } },
        },
        content: {
          'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
          'audio/mpeg': { schema: { type: 'string', format: 'binary' } },
          'audio/wav': { schema: { type: 'string', format: 'binary' } },
          'application/pdf': { schema: { type: 'string', format: 'binary' } },
          'image/jpeg': { schema: { type: 'string', format: 'binary' } },
          'image/png': { schema: { type: 'string', format: 'binary' } },
        },
      },
      PartialBinaryFile: {
        description: 'Partial binary file stream',
        headers: {
          'Accept-Ranges': { schema: { type: 'string', example: 'bytes' } },
          'Content-Range': { schema: { type: 'string', example: 'bytes 0-1023/4096' } },
          'Content-Length': { schema: { type: 'integer' } },
        },
        content: {
          'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
          'audio/mpeg': { schema: { type: 'string', format: 'binary' } },
          'application/pdf': { schema: { type: 'string', format: 'binary' } },
        },
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' },
        },
        required: ['error'],
      },
      OkResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', const: true },
        },
        required: ['ok'],
      },
      AuthCredentials: {
        type: 'object',
        properties: {
          username: { type: 'string', minLength: 3 },
          password: { type: 'string', minLength: 12, format: 'password' },
        },
        required: ['username', 'password'],
      },
      ChangePasswordRequest: {
        type: 'object',
        properties: {
          currentPassword: { type: 'string', format: 'password' },
          newPassword: { type: 'string', minLength: 12, format: 'password' },
        },
        required: ['currentPassword', 'newPassword'],
      },
      AuthUser: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          username: { type: 'string' },
        },
        required: ['id', 'username'],
      },
      NamedEntity: {
        type: 'object',
        properties: {
          id: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
          name: { type: 'string' },
        },
        required: ['name'],
      },
      MediaFile: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          filename: { type: 'string' },
          filepath: { type: 'string' },
          mime: { type: ['string', 'null'] },
        },
        required: ['filename', 'filepath'],
      },
      RankEntry: {
        type: 'object',
        additionalProperties: true,
        properties: {
          term: { type: 'string' },
          category: { type: 'string' },
          rank: { type: 'integer' },
          rank_date: { type: 'string' },
        },
      },
      WorkStats: {
        type: 'object',
        additionalProperties: true,
        properties: {
          dl_count: { type: 'integer' },
          rate_average_2dp: { type: 'number' },
          rate_count: { type: 'integer' },
          review_count: { type: 'integer' },
          rank: {
            type: 'array',
            items: { $ref: '#/components/schemas/RankEntry' },
          },
          rate_count_detail: {
            oneOf: [
              { type: 'object', additionalProperties: { type: 'integer' } },
              { type: 'null' },
            ],
          },
        },
      },
      Work: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          rjcode: { type: 'string', example: '00123456' },
          title: { type: ['string', 'null'] },
          circle: {
            oneOf: [{ $ref: '#/components/schemas/NamedEntity' }, { type: 'null' }],
          },
          nsfw: { type: 'boolean' },
          ageRating: { type: 'string', enum: ['sfw', 'r15', 'r18'] },
          release: { type: ['string', 'null'], format: 'date' },
          series: {
            oneOf: [{ $ref: '#/components/schemas/NamedEntity' }, { type: 'null' }],
          },
          tags: {
            type: 'array',
            items: { $ref: '#/components/schemas/NamedEntity' },
          },
          vas: {
            type: 'array',
            items: { $ref: '#/components/schemas/NamedEntity' },
          },
          stats: { $ref: '#/components/schemas/WorkStats' },
          base_dir: { type: ['string', 'null'] },
          cover_path: { type: ['string', 'null'] },
          media: {
            type: 'array',
            items: { $ref: '#/components/schemas/MediaFile' },
          },
        },
        required: ['id', 'rjcode'],
      },
      WorkUpdate: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          circle: { $ref: '#/components/schemas/NamedEntity' },
          nsfw: { type: 'boolean' },
          ageRating: { type: 'string', enum: ['sfw', 'r15', 'r18'] },
          release: { type: 'string', format: 'date' },
          series: {
            oneOf: [{ $ref: '#/components/schemas/NamedEntity' }, { type: 'null' }],
          },
          tags: {
            type: 'array',
            items: { $ref: '#/components/schemas/NamedEntity' },
          },
          vas: {
            type: 'array',
            items: { $ref: '#/components/schemas/NamedEntity' },
          },
          stats: { $ref: '#/components/schemas/WorkStats' },
          base_dir: { type: ['string', 'null'] },
          cover_path: { type: ['string', 'null'] },
        },
      },
      PaginatedWorks: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
          total: { type: 'integer' },
          totalPages: { type: 'integer' },
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/Work' },
          },
          hasNext: { type: 'boolean' },
          hasPrev: { type: 'boolean' },
        },
        required: ['page', 'pageSize', 'total', 'totalPages', 'items', 'hasNext', 'hasPrev'],
      },
      Collection: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string', minLength: 1, maxLength: 100 },
          type: { type: 'string', enum: ['manual', 'smart'] },
          match: {
            type: 'string',
            enum: ['and', 'or'],
            description: 'and requires every selected tag; or requires at least one selected tag.',
          },
          contentFilter: {
            type: 'string',
            enum: ['sfw', 'r15', 'r18', 'all', 'custom'],
            description: 'Legacy single rating summary; custom means the exact selection is in ageRatings.',
          },
          ageRatings: { type: 'array', uniqueItems: true, items: { type: 'string', enum: ['sfw', 'r15', 'r18'] } },
          tags: {
            type: 'array',
            maxItems: 50,
            items: { type: 'string', minLength: 1, maxLength: 80 },
          },
          workCount: { type: 'integer', minimum: 0 },
          containsWork: { type: 'boolean' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' },
        },
        required: ['id', 'name', 'type', 'match', 'contentFilter', 'ageRatings', 'tags', 'workCount'],
      },
      CollectionCreate: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          type: { type: 'string', enum: ['manual', 'smart'], default: 'manual' },
          match: { type: 'string', enum: ['and', 'or'], default: 'and' },
          contentFilter: {
            type: 'string',
            enum: ['sfw', 'r15', 'r18', 'all', 'nsfw'],
            default: 'all',
            description: 'Legacy single rating input; ageRatings takes precedence. Ignored for manual collections.',
          },
          ageRatings: { type: 'array', uniqueItems: true, items: { type: 'string', enum: ['sfw', 'r15', 'r18'] }, description: 'Selected ratings for a smart collection. Empty array matches no works.' },
          tags: {
            type: 'array',
            maxItems: 50,
            items: { type: 'string', minLength: 1, maxLength: 80 },
            description: 'Required and non-empty for smart collections; ignored for manual collections.',
          },
        },
        required: ['name'],
      },
      CollectionUpdate: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          type: { type: 'string', enum: ['manual', 'smart'] },
          match: { type: 'string', enum: ['and', 'or'] },
          contentFilter: {
            type: 'string',
            enum: ['sfw', 'r15', 'r18', 'all', 'nsfw'],
            description: 'Legacy single rating input; ageRatings takes precedence. Ignored for manual collections.',
          },
          ageRatings: { type: 'array', uniqueItems: true, items: { type: 'string', enum: ['sfw', 'r15', 'r18'] }, description: 'Selected ratings for a smart collection. Empty array matches no works.' },
          tags: {
            type: 'array',
            maxItems: 50,
            items: { type: 'string', minLength: 1, maxLength: 80 },
            description: 'A smart collection must have at least one tag after the update.',
          },
        },
      },
      CollectionMembershipUpdate: {
        type: 'object',
        properties: {
          included: { type: 'boolean' },
        },
        required: ['included'],
      },
      FacetItem: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'integer' },
        },
        required: ['name'],
      },
      Facets: {
        type: 'object',
        properties: {
          circles: { type: 'array', items: { $ref: '#/components/schemas/FacetItem' } },
          tags: { type: 'array', items: { $ref: '#/components/schemas/FacetItem' } },
          vas: { type: 'array', items: { $ref: '#/components/schemas/FacetItem' } },
        },
        required: ['circles', 'tags', 'vas'],
      },
      CircleSummary: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'integer' },
          newestWorkId: { type: 'integer' },
          newestCoverPath: { type: ['string', 'null'] },
          newestTitle: { type: ['string', 'null'] },
          newestRelease: { type: ['string', 'null'], format: 'date' },
        },
        required: ['name', 'count'],
      },
      Settings: {
        type: 'object',
        additionalProperties: false,
        properties: {
          autoplayFolder: { type: 'boolean' },
          defaultScanPaths: { type: 'array', items: { type: 'string' } },
          httpProxyEnabled: { type: 'boolean' },
          httpProxyHost: { type: 'string' },
          httpProxyPort: { type: 'integer' },
          httpProxyUsername: { type: 'string' },
          httpProxyPassword: { type: 'string', format: 'password' },
          autoScanEnabled: { type: 'boolean' },
          autoScanMode: { type: 'string', enum: ['interval', 'daily'] },
          autoScanIntervalMinutes: { type: 'integer', minimum: 1 },
          autoScanDailyTime: { type: 'string', pattern: '^\\d{1,2}:\\d{2}$' },
          timeZone: { type: 'string', description: 'IANA timezone used for daily scans and server-log display; detected locally with UTC fallback when omitted' },
          lastScanAt: { type: 'string', format: 'date-time' },
          serverLogLevels: {
            type: 'array',
            items: { type: 'string', enum: ['info', 'warn', 'error'] },
            uniqueItems: true,
            description: 'Log levels emitted, buffered, and streamed by the server. Defaults to all levels.',
          },
        },
      },
      SettingsUpdate: {
        allOf: [{ $ref: '#/components/schemas/Settings' }],
      },
      ProxyCheckResult: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          checkedAt: { type: 'string', format: 'date-time' },
          ip: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              address: { type: 'string' },
              error: { type: 'string' },
            },
            required: ['ok'],
          },
          dlsite: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              status: { type: 'integer' },
              error: { type: 'string' },
            },
            required: ['ok'],
          },
        },
        required: ['ok', 'checkedAt', 'ip', 'dlsite'],
      },
      LogEntry: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['info', 'warn', 'error'] },
          message: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
          data: true,
        },
        required: ['level', 'message', 'timestamp'],
      },
      AttachMediaRequest: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['files'],
      },
      DlsiteImportRequest: {
        type: 'object',
        properties: {
          id: {
            oneOf: [{ type: 'integer' }, { type: 'string' }],
            description: 'RJ digits or any string containing a 6- or 8-digit RJ id.',
          },
          language: { type: 'string', enum: ['ja-jp', 'zh-tw', 'zh-cn'], default: 'ja-jp' },
          mediaPath: { type: 'string' },
          coverPath: { type: 'string' },
          forceCoverRefresh: { type: 'boolean', default: false },
        },
        required: ['id'],
      },
      PathResponse: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
      FileItem: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          isDir: { type: 'boolean' },
          size: { type: 'integer' },
          mtime: { type: 'number' },
          relPath: { type: 'string' },
          mime: { type: ['string', 'null'] },
          isAudio: { type: 'boolean' },
          isImage: { type: 'boolean' },
          isVideo: { type: 'boolean' },
          isPdf: { type: 'boolean' },
        },
        required: ['name', 'isDir', 'relPath'],
      },
      FileListing: {
        type: 'object',
        properties: {
          base: { type: 'string' },
          path: { type: 'string' },
          parent: { type: ['string', 'null'] },
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/FileItem' },
          },
        },
        required: ['base', 'path', 'items'],
      },
      ScanRequest: {
        type: 'object',
        properties: {
          path: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
          },
          language: { type: 'string', enum: ['ja-jp', 'zh-tw', 'zh-cn'], default: 'ja-jp' },
          dryRun: { type: 'boolean', default: false },
          newOnly: { type: 'boolean', default: true },
          metadataOnly: { type: 'boolean', default: false },
        },
      },
      ScanCandidate: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          mediaPath: { type: 'string' },
          reason: { type: 'string', enum: ['folder', 'file'] },
        },
        required: ['id', 'mediaPath', 'reason'],
      },
      ScanImportedItem: {
        type: 'object',
        properties: {
          id: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
          title: { type: ['string', 'null'] },
          mediaPath: { type: 'string' },
          retried: { type: 'integer' },
        },
        required: ['id', 'title', 'mediaPath'],
      },
      ScanErrorItem: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          mediaPath: { type: 'string' },
          error: { type: 'string' },
          attempt: { type: 'integer' },
        },
        required: ['id', 'mediaPath', 'error'],
      },
      ScanResult: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' } },
          invalidPaths: { type: 'array', items: { type: 'string' } },
          imported: { type: 'array', items: { $ref: '#/components/schemas/ScanImportedItem' } },
          errors: { type: 'array', items: { $ref: '#/components/schemas/ScanErrorItem' } },
          invalidUpdated: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
            },
          },
          mode: { type: 'string', enum: ['new-only', 'full', 'metadata-only'] },
        },
        required: ['paths', 'invalidPaths', 'imported', 'errors', 'invalidUpdated', 'mode'],
      },
      ScanDryRunResult: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' } },
          invalidPaths: { type: 'array', items: { type: 'string' } },
          found: { type: 'array', items: { $ref: '#/components/schemas/ScanCandidate' } },
          mode: { type: 'string', enum: ['new-only', 'full', 'metadata-only'] },
        },
        required: ['paths', 'invalidPaths', 'found', 'mode'],
      },
      ScanJobStatus: {
        type: 'object',
        properties: {
          jobId: { type: ['string', 'null'] },
          status: { type: 'string', enum: ['running', 'done', 'error', 'timeout', 'idle'] },
        },
        required: ['jobId', 'status'],
      },
    },
  },
} as const;
