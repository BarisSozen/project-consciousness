import { describe, it, expect } from 'vitest';
import { inferRecommendations } from '../src/orchestrator/interactive-selector.js';

describe('inferRecommendations', () => {
  it('should recommend JWT for auth-related briefs', () => {
    const recs = inferRecommendations('Build a todo app with user login and registration');
    expect(recs.get('auth')).toBe('jwt');
  });

  it('should recommend PostgreSQL for e-commerce briefs', () => {
    const recs = inferRecommendations('Build an e-commerce platform with products and orders');
    expect(recs.get('database')).toBe('postgresql');
  });

  it('should recommend SQLite for simple/prototype briefs', () => {
    const recs = inferRecommendations('Build a simple todo app prototype');
    expect(recs.get('database')).toBe('sqlite');
  });

  it('should recommend MongoDB for document-based briefs', () => {
    const recs = inferRecommendations('Build a flexible document storage system with NoSQL');
    expect(recs.get('database')).toBe('mongodb');
  });

  it('should recommend REST by default', () => {
    const recs = inferRecommendations('Build an API');
    expect(recs.get('apiStyle')).toBe('rest');
  });

  it('should recommend GraphQL when mentioned', () => {
    const recs = inferRecommendations('Build a GraphQL API for the mobile app');
    expect(recs.get('apiStyle')).toBe('graphql');
  });

  it('should recommend api-only for backend briefs', () => {
    const recs = inferRecommendations('Build a REST API backend service');
    expect(recs.get('frontend')).toBe('api-only');
  });

  it('should recommend React for frontend/dashboard briefs', () => {
    const recs = inferRecommendations('Build a fullstack dashboard with frontend');
    expect(recs.get('frontend')).toBe('react');
  });

  it('should recommend Next.js for SSR briefs', () => {
    const recs = inferRecommendations('Build a fullstack Next.js app with SSR');
    expect(recs.get('frontend')).toBe('nextjs');
  });

  it('should recommend Docker when mentioned', () => {
    const recs = inferRecommendations('Build a containerized Docker microservice');
    expect(recs.get('deployment')).toBe('docker');
  });

  it('should handle Turkish briefs', () => {
    const recs = inferRecommendations('Kullanıcı girişi olan basit bir e-ticaret uygulaması');
    expect(recs.get('auth')).toBe('jwt');
    expect(recs.get('database')).toBe('postgresql');
  });
});
