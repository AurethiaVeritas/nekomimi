import request from 'supertest';
import app from '../../server/index';
import { bootstrapTestUser } from '../helpers/auth';

describe('OpenAPI documentation', () => {
  it('serves the OpenAPI document without authentication', async () => {
    const res = await request(app)
      .get('/api/openapi.json');

    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.info.title).toBe('Nekomimi HTTP API');
    expect(res.body.paths['/api/works']).toBeDefined();
    expect(res.body.paths['/api/collections']).toBeDefined();
    expect(res.body.paths['/api/collections/{id}']).toBeDefined();
    expect(res.body.paths['/api/collections/{id}/works']).toBeDefined();
    expect(res.body.paths['/api/collections/{id}/works/{workId}']).toBeDefined();
    expect(res.body.components.schemas.Collection).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['id', 'name', 'type', 'match', 'contentFilter', 'tags', 'workCount']),
    });
    expect(res.body.components.schemas.CollectionCreate.properties.contentFilter).toMatchObject({
      enum: ['sfw', 'r15', 'r18', 'all', 'nsfw'],
      default: 'all',
    });
    expect(res.body.paths['/api/works'].get.responses['200'].content['application/json'].schema)
      .toEqual({ $ref: '#/components/schemas/PaginatedWorks' });
    expect(res.body.components.schemas.WorkUpdate.properties).not.toHaveProperty('circle_name');
    expect(res.body.components.schemas.WorkUpdate.properties).not.toHaveProperty('series_name');
    expect(res.body.components.schemas.AttachMediaRequest.properties.files.items).toEqual({ type: 'string' });
    expect(res.body.components.schemas.Settings.properties).not.toHaveProperty('theme');
    expect(res.body.components.schemas.Settings.properties).not.toHaveProperty('allowedLibraryPaths');
    expect(res.body.components.schemas.Settings.properties.httpProxyPort).toEqual({ type: 'integer' });
    expect(res.body.paths['/api/collections'].post.security).toEqual([{ cookieAuth: [] }]);
    expect(res.body.components.securitySchemes.cookieAuth).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'auth',
    });
  });

  it('serves Swagger UI without authentication', async () => {
    const res = await request(app)
      .get('/api/docs/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Nekomimi API Docs');
    expect(res.text).toContain('swagger-ui-bundle.js');
  });

  it('redirects the docs path to the trailing-slash asset root', async () => {
    const res = await request(app)
      .get('/api/docs');

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/api/docs/');
  });

  it('serves Swagger UI assets without authentication', async () => {
    const res = await request(app)
      .get('/api/docs/swagger-ui-bundle.js');

    expect(res.status).toBe(200);
    expect(res.type).toBe('text/javascript');
  });

  it('serves documentation when the browser already has an auth session', async () => {
    const agent = request.agent(app);
    await bootstrapTestUser(agent, 'openapi-docs-user');

    const docs = await agent.get('/api/docs/');
    expect(docs.status).toBe(200);
    expect(docs.text).toContain('Nekomimi API Docs');
    expect(docs.text).toContain('swagger-ui-bundle.js');

    const spec = await agent.get('/api/openapi.json');
    expect(spec.status).toBe(200);
    expect(spec.body.info.title).toBe('Nekomimi HTTP API');
  });
});
