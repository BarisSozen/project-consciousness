import { describe, it, expect } from 'vitest';
import { Calculator } from '../src/calculator/calculator.js';

describe('Calculator', () => {
  const calc = new Calculator();

  describe('add', () => {
    it('should add two positive numbers', () => {
      expect(calc.add(2, 3)).toBe(5);
    });

    it('should handle negative numbers', () => {
      expect(calc.add(-1, -2)).toBe(-3);
    });
  });

  describe('subtract', () => {
    it('should subtract two numbers', () => {
      expect(calc.subtract(10, 4)).toBe(6);
    });

    it('should handle negative results', () => {
      expect(calc.subtract(3, 7)).toBe(-4);
    });
  });

  describe('multiply', () => {
    it('should multiply two numbers', () => {
      expect(calc.multiply(3, 4)).toBe(12);
    });

    it('should handle negative numbers', () => {
      expect(calc.multiply(-2, 5)).toBe(-10);
    });
  });

  describe('divide', () => {
    it('should divide two numbers', () => {
      expect(calc.divide(10, 2)).toBe(5);
    });

    it('should throw on division by zero', () => {
      expect(() => calc.divide(5, 0)).toThrow('Division by zero');
    });

    it('should handle negative division', () => {
      expect(calc.divide(-10, 2)).toBe(-5);
    });
  });
});
