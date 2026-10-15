import { createContext, useContext } from 'react';
export const GameContext = createContext(null);
export const useGame = () => useContext(GameContext);
