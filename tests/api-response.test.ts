import test from 'node:test';
import assert from 'node:assert/strict';
import {readApiResponse} from '../shared/api-response.ts';
import {DATABASE_QUOTA_MESSAGE} from '../shared/database-errors.ts';

test('hosting failures explain preview versus uncertain commit without reporting a successful import',async()=>{
 await assert.rejects(readApiResponse(new Response('FUNCTION_INVOCATION_FAILED',{status:500}),'catalog-preview'),/preview could not start \(HTTP 500\)/);
 await assert.rejects(readApiResponse(new Response('<html>Gateway timeout</html>',{status:504}),'catalog-commit'),/result could not be confirmed.*same import reference/);
 await assert.rejects(readApiResponse(new Response('<html>Sign in</html>',{status:200}),'catalog-preview'),/unreadable response/);
});
test('valid responses and useful validation or quota errors remain intact',async()=>{
 assert.deepEqual(await readApiResponse(Response.json({updated:3})),{updated:3});
 await assert.rejects(readApiResponse(Response.json({error:'Row 2: invalid price'},{status:400})),/Row 2: invalid price/);
 await assert.rejects(readApiResponse(Response.json({error:'Database quota exceeded'},{status:503})),{message:DATABASE_QUOTA_MESSAGE});
});
