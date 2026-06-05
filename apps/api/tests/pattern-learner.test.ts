import { describe, expect, it } from 'bun:test';
import {
  compileTemplate,
  generateTemplateCandidate,
} from '../src/services/ai/patternLearner.ts';

describe('PatternLearner Unit Tests', () => {
  describe('generateTemplateCandidate', () => {
    it('generates a simple template from text and parsed results', () => {
      const text = 'spent 450 on auto';
      const parsed = { amount: 450, description: 'auto' };
      const template = generateTemplateCandidate(text, parsed);
      expect(template).toBe('spent {amount} on {description}');
    });

    it('handles currency symbol prefixing', () => {
      const text = '₹500 for groceries';
      const parsed = { amount: 500, description: 'groceries' };
      const template = generateTemplateCandidate(text, parsed);
      expect(template).toBe('₹{amount} for {description}');
    });

    it('returns null if description cannot be mapped', () => {
      const text = 'spent 450 on auto';
      const parsed = { amount: 450, description: 'coffee' };
      const template = generateTemplateCandidate(text, parsed);
      expect(template).toBeNull();
    });

    it('returns null if amount cannot be mapped', () => {
      const text = 'spent on auto';
      const parsed = { amount: 450, description: 'auto' };
      const template = generateTemplateCandidate(text, parsed);
      expect(template).toBeNull();
    });
  });

  describe('compileTemplate', () => {
    it('compiles a simple template to a safe anchored regex', () => {
      const template = 'spent {amount} on {description}';
      const compiled = compileTemplate(template);
      
      expect(compiled.fields).toEqual(['amount', 'description']);
      expect(compiled.regex).toBe('^spent\\s+(\\d+(?:\\.\\d+)?)\\s+on\\s+(.+)$');

      const regex = new RegExp(compiled.regex, 'i');
      const match = regex.exec('spent 600 on coffee');
      expect(match).not.toBeNull();
      expect(match![1]).toBe('600');
      expect(match![2]).toBe('coffee');
    });

    it('compiles template with multiple placeholders', () => {
      const template = '{amount} {currency} on {description} via {walletHint}';
      const compiled = compileTemplate(template);
      
      expect(compiled.fields).toEqual(['amount', 'currency', 'description', 'walletHint']);
      
      const regex = new RegExp(compiled.regex, 'i');
      const match = regex.exec('150 usd on dinner via credit card');
      expect(match).not.toBeNull();
      expect(match![1]).toBe('150');
      expect(match![2]).toBe('usd');
      expect(match![3]).toBe('dinner');
      expect(match![4]).toBe('credit card');
    });
  });
});
