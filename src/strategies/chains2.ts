import { cellPath as CP, SudokuGrid } from '../utils/cellPath'
import {
  isOnly,
  Update,
  Solution,
  applySolution,
} from '../utils/solutionObject'

import {
  solveEach,
  applyStrats,
  solveSingleOptionFullGrid /*limitStratsTo*/,
} from '../solver/applyStrats'

import * as R from 'ramda'

// 7. A chain finds a divergent pair (or more) of different possible answers
// for a cell (for example, [7,8]) and plays out what will happen if we guess
// either answer and check for any resulting answers that end up being the
// same for either path. For example, if cell 70 being a 7 or an 8 both result
// in cell 80 becoming a 3, then I know cell 80 must be 3.

// Chains can be quite flexible, as we can apply a host of other strategies
// to attempt to find updates after making our divergent paths.
// To accomodate this, I have created a curried "chainTemplate" function
// that uses the applyStrats function and can make a new chain function
// incorporating any number of strategies to apply to the divergent paths.
// For the time being, I will only be using this for the simplest chain,
// the "X-chain" applied when only two answers are left, that just checks
// for cells that become answered immediately with the "solveSingleOption"
// function.

// To simulate this with programming, we will maintain two (or more)
// separate sudoku grids, continue to work out updates that result
// with the given strategy, and then compare to see if any cells have the
// same changes for each.

// The "chainTemplate" function creates the diverging paths
// and the "findChainOverlapUpdates" function then applies strategies to each
// and checks for overlapping changes.
// The getTotalSolutionsWithRounds function updates a data tracking object
// that shows what updates were found for each sweep of the chain-link
// for each diverging sudoku grid, which can then be used with the filterbest
// function to find the easiest solution as well as used for data visualization
// to demonstrate how the chain-sweep worked

const getTotalSolutionsWithRounds = (
  currentSolutionsFound: (Boolean | (Solution | Solution[])[])[],
  allSolutionsFound: (Boolean | (Solution | Solution[])[])[] | false, // ??
  currentRound: number
) => {
  // add current round of chain-sweep to solutionsFound
  const currentSolutionsWithRound = currentSolutionsFound.map((solutionSet) =>
    solutionSet === false
      ? false
      : (solutionSet as (Solution | Solution[])[]).map((singleSolution) => ({
          ...singleSolution,
          chainRound: currentRound,
        }))
  )

  // keep updated data on solutions found for each divergent map
  // during each sweep of the chain updates (to use for data visualization)
  const totalSolutionsWithRounds = allSolutionsFound
    ? allSolutionsFound.map((solutions, i) => {
        if (solutions === false || currentSolutionsWithRound[i] === false) {
          return solutions
        } else {
          return [
            ...(solutions as (Solution | Solution[])[]),
            currentSolutionsWithRound[i],
          ]
        }
      })
    : currentSolutionsWithRound

  return totalSolutionsWithRounds
}

const findChainOverlapUpdates = (
  sudokuGrid: SudokuGrid,
  startingPaths: SudokuGrid[],
  stratsUsed: ReturnType<typeof applyStrats>,
  roundUpdates: (Boolean | (Solution | Solution[])[])[] | false = false,
  round = 1
):
  | {
      updatesFound: Update[]
      totalSolutionsWithRounds: any //
      totalChainRounds: number
    }
  | false => {
  // apply strategy to each branch and reject if both false
  const solutionsFoundForEach = startingPaths.map((x) => stratsUsed(x))
  if (solutionsFoundForEach.every((x) => x === false)) {
    return false
  }

  const totalSolutionsWithRounds = getTotalSolutionsWithRounds(
    solutionsFoundForEach,
    roundUpdates,
    round
  )

  // map out updated paths with solutions found or keep old path if no update possible
  const currentPaths = solutionsFoundForEach.map((solutionSet, i) =>
    solutionSet
      ? applySolution(startingPaths[i], solutionSet as Solution | Solution[])
      : startingPaths[i]
  )

  // find shared changes
  const holder = R.repeat([], 81)

  //
  //const combinedAnswerOptions = holder.map((answerOptions, index) =>
  //currentPaths.map((path) => path[index]).flat()
  //)
  //
  const sharedUpdates = currentPaths
    .reduce(
      (prev, curr) => prev.map((x, i) => (x as number[]).concat(curr[i])),
      holder
    )
    .map((x, i) => ({
      index: i,
      answerOptions: R.range(1, 10).filter(
        (y) => x === y || (x as number[]).includes(y)
      ),
    }))
    .filter(
      (x, i) =>
        typeof sudokuGrid[i] === 'object' && // filter out already solved
        !R.equals(x.answerOptions, sudokuGrid[i])
    )
  // if shared change(s) found, return updates for solution object
  if (sharedUpdates.length > 0) {
    const updatesFound = sharedUpdates.map(
      (x) =>
        new Update({
          index: x.index,
          sudokuGrid,
          removal: isOnly(x.answerOptions),
        })
    )
    return {
      updatesFound,
      totalSolutionsWithRounds,
      totalChainRounds: round,
    }
  }

  // if no shared changes, attempt next round of updates
  return findChainOverlapUpdates(
    sudokuGrid,
    currentPaths,
    stratsUsed,
    totalSolutionsWithRounds,
    round + 1
  )
}

const chainTemplate = (
  stratsUsed: ReturnType<typeof applyStrats>,
  answerLen: number,
  description: string
) => (sudokuGrid: SudokuGrid, cellIndex: number) => {
  // check for open with correct number of options and reject if cellIndex already solved
  if (
    typeof sudokuGrid[cellIndex] === 'number' ||
    (sudokuGrid[cellIndex] as number[]).length !== answerLen
  ) {
    return false
  }
  // generate starting grids based on diverging paths
  const startingPaths = (sudokuGrid[cellIndex] as number[])
    .map((answer) => isOnly(answer)) // map answers to remove
    .map(
      (remove) => new Update({ index: cellIndex, sudokuGrid, removal: remove })
    ) // map updates
    .map(
      (update) =>
        new Solution({
          strategy: 'NA-chainAttempt',
          cellInit: [cellIndex],
          updates: [update],
        })
    ) // map solutions
    .map((sol) => applySolution(sudokuGrid, sol)) // map starting grids
  // find first possible updates based on overlapping chains
  const chainOverlapUpdates = findChainOverlapUpdates(
    sudokuGrid,
    startingPaths,
    stratsUsed
  )
  if (!chainOverlapUpdates) {
    return false
  }
  const {
    updatesFound,
    totalSolutionsWithRounds,
    totalChainRounds,
  } = chainOverlapUpdates

  const additionalSolutionInfo = {
    startingPaths,
    totalSolutionsWithRounds,
    totalChainRounds,
  }
  return new Solution({
    strategy: description,
    cellInit: [cellIndex],
    updates: updatesFound,
    additionalNotes: additionalSolutionInfo,
  })
}

// solves x-chain on single cell
export const solveXChain = chainTemplate(
  applyStrats([solveSingleOptionFullGrid]),
  2,
  'X-Chain'
)

// expands solveXChain to apply across the full grid
export const solveXChainFullGrid = (sudokuGrid: SudokuGrid) => {
  const solutionsFound = CP.allIndex
    .map((index) => solveXChain(sudokuGrid, index))
    .filter((x) => x !== false)
  if (solutionsFound.length === 0) return false
  return solutionsFound as Solution[]
}
