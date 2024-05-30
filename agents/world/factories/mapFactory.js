const tileTypesData = [
    { name: "forest", constraints: ["desert"] },
    { name: "water", constraints: ["desert"] },
    { name: "desert", constraints: ["forest", "marsh"] },
    { name: "mountains", constraints: [] }, // Mountains can be adjacent to any tile
    { name: "grassland", constraints: [] }, // Grassland can be adjacent to any tile
    { name: "marsh", constraints: ["desert"] }
];

const adjacencyMatrix = tileTypesData.reduce((acc, tile) => {
    acc[tile.name] = tileTypesData.filter(t => !tile.constraints.includes(t.name)).map(t => t.name);
    return acc;
}, {});

const ecosystemWeightings = {
    Forest: { forest: 0.6, grassland: 0.2, water: 0.1, mountains: 0.05, marsh: 0.05, desert: 0 },
    Desert: { desert: 0.6, grassland: 0.2, mountains: 0.1, water: 0.05, marsh: 0.05, forest: 0 },
    Plains: { grassland: 0.6, forest: 0.2, mountains: 0.1, water: 0.05, marsh: 0.05, desert: 0 },
    Coastal: { water: 0.4, grassland: 0.2, forest: 0.1, marsh: 0.1, mountains: 0.1, desert: 0.1 },
    Marsh: { marsh: 0.5, water: 0.2, grassland: 0.15, forest: 0.1, mountains: 0.05, desert: 0 },
    Mountains: { mountains: 0.5, forest: 0.2, grassland: 0.2, water: 0.05, marsh: 0.05, desert: 0 }
};

const applyClusterModifier = (baseWeightings, clusterType) => {
    const modifier = 2; // Bias to increase cluster-specific areas in the region
    const modifiedWeightings = { ...baseWeightings };

    for (const tile in modifiedWeightings) {
        if (tile === clusterType) {
            modifiedWeightings[tile] += modifier;
        }
    }

    // Normalize the weightings to ensure they sum to 1
    const totalWeight = Object.values(modifiedWeightings).reduce((sum, weight) => sum + weight, 0);
    for (const tile in modifiedWeightings) {
        modifiedWeightings[tile] /= totalWeight;
    }

    return modifiedWeightings;
}

const getClusterWeightings = (regionEcosystem, clusterType) => {
    if (!ecosystemWeightings[regionEcosystem]) {
        console.error(`Invalid region ecosystem: ${regionEcosystem}`);
        return {};
    }

    const baseWeightings = ecosystemWeightings[regionEcosystem];
    return applyClusterModifier(baseWeightings, clusterType);
}

const getNeighbors = (grid, x, y) => {
    const positions = [
        [x-1, y], [x+1, y], [x, y-1], [x, y+1], 
        [x-1, y-1], [x+1, y+1], [x-1, y+1], [x+1, y-1]
    ];

    return positions.map(([nx, ny]) => {
        if (nx >= 0 && ny >= 0 && nx < grid.length && ny < grid[0].length) {
            return grid[nx][ny];
        }
        return null;
    });
}

const selectTileTypeBasedOnWeights = (weightings, neighbors) => {
    const tiles = Object.keys(weightings);
    if (tiles.length === 0) {
        console.error("No valid tile types found based on the provided weightings.");
        return null;
    }
    
    const bias = 0.5; // Bias to encourage groupings of like tiles
    const neighborTiles = neighbors.filter(tile => tile !== null);
    const neighborCounts = neighborTiles.reduce((acc, tile) => {
        acc[tile] = (acc[tile] || 0) + 1;
        return acc;
    }, {});

    // Initialize total weight to 0
    let totalWeight = 0;

    const biasedWeightings = {};
    for (const tile of tiles) {
        if (neighborCounts[tile]) {
            biasedWeightings[tile] = weightings[tile] + bias * neighborCounts[tile];
        } else {
            biasedWeightings[tile] = weightings[tile];
        }
        totalWeight += biasedWeightings[tile];
    }

    // Normalize the weightings to ensure they sum to 1
    for (const tile in biasedWeightings) {
        biasedWeightings[tile] /= totalWeight;
    }

    const rand = Math.random();
    let cumulativeWeight = 0;

    for (const tile of tiles) {
        cumulativeWeight += biasedWeightings[tile];
        if (rand < cumulativeWeight) {
            return tile;
        }
    }
    return tiles[tiles.length - 1]; // Fallback in case of rounding issues
}

const fillCluster = (detailedGrid, startX, startY, weightings) => {
    for (let i = startX; i < startX + 5; i++) {
        for (let j = startY; j < startY + 5; j++) {
            const neighbors = getNeighbors(detailedGrid, i, j);

            // Filter valid tiles based on adjacency constraints
            const validTiles = Object.keys(weightings).filter(tile =>
                neighbors.every(neighbor => neighbor === null || adjacencyMatrix[tile].includes(neighbor))
            );

            if (validTiles.length === 0) {
                console.error("No valid tile types found based on adjacency constraints.");
                continue;
            }

            const filteredWeightings = Object.fromEntries(Object.entries(weightings).filter(([tile]) => validTiles.includes(tile)));
            detailedGrid[i][j] = selectTileTypeBasedOnWeights(filteredWeightings, neighbors);
        }
    }
}

const generateHighLevelClusters = (regionEcosystem) => {
    if (!ecosystemWeightings[regionEcosystem]) {
        console.error(`Invalid region ecosystem: ${regionEcosystem}`);
        return [];
    }

    const highLevelGrid = Array(5).fill().map(() => Array(5).fill(null));
    for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
            highLevelGrid[i][j] = selectTileTypeBasedOnWeights(ecosystemWeightings[regionEcosystem], []);
        }
    }
    return highLevelGrid;
}

const generateDetailedMap = (highLevelGrid, regionEcosystem) => {
    if (!Array.isArray(highLevelGrid) || highLevelGrid.length === 0) {
        console.error("Invalid high-level grid provided.");
        return [];
    }

    const detailedGrid = Array(25).fill().map(() => Array(25).fill(null));
    for (let i = 0; i < highLevelGrid.length; i++) {
        for (let j = 0; j < highLevelGrid[i].length; j++) {
            const clusterWeightings = getClusterWeightings(regionEcosystem, highLevelGrid[i][j]);
            if (Object.keys(clusterWeightings).length === 0) {
                console.error("Invalid cluster weightings returned.");
                continue;
            }
            fillCluster(detailedGrid, i * 5, j * 5, clusterWeightings);
        }
    }
    return detailedGrid;
}

module.exports = {
    generateHighLevelClusters,
    generateDetailedMap
};