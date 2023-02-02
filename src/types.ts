export type genericPlaceOptions = {
    offhand: boolean;
    delta: boolean;
    half: "top" | "bottom";
    forceLook: boolean | "ignore";
    swingArm: 'right' | 'left', 
    showHand: boolean
};


export type DeepPartial<T> = T extends object ? {
    [P in keyof T]?: DeepPartial<T[P]>;
} : T;