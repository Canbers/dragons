const getSurroundingVectors = (vector) => {
    if (!Array.isArray(vector) || vector.length !== 2) {
      throw new Error("Invalid input: vector should be an array of two integers.");
    }
  
    const [x, y] = vector;
  
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new Error("Invalid input: vector elements should be integers.");
    }
  
    const surroundingVectors = [
      [x, y - 1],     // Top
      [x + 1, y - 1], // Top-right
      [x + 1, y],     // Right
      [x + 1, y + 1], // Bottom-right
      [x, y + 1],     // Bottom
      [x - 1, y + 1], // Bottom-left
      [x - 1, y],     // Left
      [x - 1, y - 1], // Top-left
    ];
  
    return surroundingVectors;
  }

  module.exports = {
    getSurroundingVectors
  }