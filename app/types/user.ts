export interface User {
    id: string;
    email?: string;
    username: string;
    discriminator?: string;
    avatar?: string;
    discordId?: string;
}