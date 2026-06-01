import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCurrentPeriodUsageResponseSchema,
  oauthTokenResponseSchema,
  parseJsonWithSchema,
  profileExportSchema,
} from '../../validation/apiSchemas';

describe('apiSchemas', () => {
  describe('getCurrentPeriodUsageResponseSchema', () => {
    it('accepts valid IDE usage response', () => {
      const parsed = parseJsonWithSchema(
        getCurrentPeriodUsageResponseSchema,
        {
          billingCycleStart: '1768399334000',
          planUsage: { totalPercentUsed: 15.48, limit: 40000 },
        },
        'test'
      );
      assert.equal(parsed.planUsage?.totalPercentUsed, 15.48);
    });

    it('rejects invalid planUsage types', () => {
      assert.throws(
        () =>
          parseJsonWithSchema(
            getCurrentPeriodUsageResponseSchema,
            { planUsage: { totalPercentUsed: 'not-a-number' } },
            'test'
          ),
        /test:/
      );
    });
  });

  describe('oauthTokenResponseSchema', () => {
    it('accepts valid token response', () => {
      const parsed = parseJsonWithSchema(
        oauthTokenResponseSchema,
        { access_token: 'abc', refresh_token: 'def' },
        'oauth'
      );
      assert.equal(parsed.access_token, 'abc');
    });

    it('rejects non-object payload', () => {
      assert.throws(
        () =>
          parseJsonWithSchema(oauthTokenResponseSchema, 'invalid', 'oauth'),
        /oauth:/
      );
    });
  });

  describe('profileExportSchema', () => {
    it('accepts valid export payload', () => {
      const parsed = parseJsonWithSchema(
        profileExportSchema,
        {
          version: '1.0',
          exportedAt: new Date().toISOString(),
          profiles: [{ email: 'a@b.com', displayName: 'A' }],
        },
        'export'
      );
      assert.equal(parsed.profiles.length, 1);
    });

    it('rejects export without profiles array', () => {
      assert.throws(
        () =>
          parseJsonWithSchema(
            profileExportSchema,
            { version: '1.0', exportedAt: new Date().toISOString() },
            'export'
          ),
        /export:/
      );
    });
  });
});
